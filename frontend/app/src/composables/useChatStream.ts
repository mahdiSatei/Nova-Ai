// Composable مرکزی چت: dual state model — connection + generation.
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  streamChat,
  resumeStream,
  retryStream,
  cancelGeneration,
  type StreamHandlers,
  type StreamStartInfo,
} from '@/api/chat'
import { getConversation, listConversations, setConversationModel } from '@/api/conversations'
import { ApiError } from '@/api/http'
import { streamErrorMessage } from '@/utils/errors'
import type { CitationSource, MessagePublic, SearchPhase, SseStatus } from '@/types/api'

const SESSION_KEY = 'mmcb.lastModelId'
const CONVERSATION_KEY = 'mmcb.lastConversationId'
const WEB_SEARCH_KEY = 'mmcb.webSearchEnabled'
const REASONING_KEY = 'mmcb.reasoningEnabled'

type SearchActivityState = {
  phase: SearchPhase
  query?: string
  sources?: number
  credits?: number
}

type ConnectionState = 'connected' | 'disconnected' | 'reconnecting'
type GenerationState = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled'

interface ActiveGeneration {
  conversationId: string
  assistantMessageId: string
  status: GenerationState
  content: string
  citations?: CitationSource[]
}

function loadSavedModelId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function saveModelId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, id)
  } catch {
    /* ignore */
  }
}

function loadSavedWebSearch(): boolean {
  try {
    return sessionStorage.getItem(WEB_SEARCH_KEY) === 'true'
  } catch {
    return false
  }
}

function saveWebSearch(enabled: boolean): void {
  try {
    sessionStorage.setItem(WEB_SEARCH_KEY, enabled ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

function loadSavedReasoning(): boolean {
  try {
    return sessionStorage.getItem(REASONING_KEY) === 'true'
  } catch {
    return false
  }
}

function saveReasoning(enabled: boolean): void {
  try {
    sessionStorage.setItem(REASONING_KEY, enabled ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

/**
 * Codes that mean "the model this client holds is not usable by this account".
 * When one arrives, drop the selection and reload the entitlement-filtered
 * catalog so the picker repopulates with what is actually available.
 */
const MODEL_REJECTION_CODES = new Set(['model_forbidden', 'model_unavailable'])

export interface ChatStreamHandle {
  connectionState: import('vue').Ref<ConnectionState>
  connectionError: import('vue').Ref<{ code: string; message: string } | null>
  generationState: import('vue').Ref<GenerationState>
  generation: import('vue').Ref<ActiveGeneration | null>
  transcript: import('vue').Ref<MessagePublic[]>
  conversationId: import('vue').Ref<string | null>
  selectedModelId: import('vue').Ref<string | null>
  inputDisabled: import('vue').ComputedRef<boolean>
  /** Non-null while the server retries or fails over before the first token (فاز ۶). */
  retrying: import('vue').Ref<{ attempt: number; maxAttempts: number } | null>
  /** Web Search preference for the next turn (فاز ۷). Disabled by default. */
  webSearchEnabled: import('vue').Ref<boolean>
  /** Live search/retrieval progress while a grounded answer is generating. */
  searchActivity: import('vue').Ref<SearchActivityState | null>
  /** Sources cited by the latest grounded answer. */
  citations: import('vue').Ref<CitationSource[]>
  /** فاز ۸ — استدلال برای نوبت بعد. فقط برای مدل‌های دارای استدلال معنا دارد. */
  reasoningEnabled: import('vue').Ref<boolean>
  /** فاز ۸ — توان مؤثر مدل انتخاب‌شده (از چیدمان عمومی مدل‌ها). */
  reasoningSupported: import('vue').Ref<boolean>
  /** فاز ۸ — وضعیت «در حال استدلال»، فقط بر اساس رویدادهای سرور. */
  reasoningActive: import('vue').Ref<boolean>
  /** فاز ۸ — استدلال این نوبت تمام شده است (بدون اینکه لزوماً محتوایی داشته باشد). */
  reasoningCompleted: import('vue').Ref<boolean>
  /** فاز ۸ — خلاصهٔ استدلال دریافتی (خالی یعنی محتوایی برای نمایش نیست). */
  reasoningSummary: import('vue').Ref<string>
  /** فاز ۸ — آیا محتوای استدلال برای نمایش وجود دارد. */
  reasoningAvailable: import('vue').ComputedRef<boolean>
  setWebSearch: (value: boolean) => void
  setReasoning: (value: boolean) => void
  setReasoningSupport: (supported: boolean) => void
  setModel: (id: string | null) => Promise<void>
  loadConversation: (id: string) => Promise<void>
  resetConversation: () => void
  send: (
    text: string,
    opts?: { fileId?: string | null; file?: MessagePublic['file'] },
  ) => Promise<void>
  abort: () => void
  replaceSnapshot: (snapshot: string) => void
  cancel: () => Promise<void>
  retry: (targetMessageId?: string) => Promise<void>
  reconnect: () => Promise<void>
  clearSavedConversationId: () => void
  loadSavedConversationId: () => string | null
}

export function useChatStream(): ChatStreamHandle {
  // ── Connection axis ──────────────────────────────────────────────
  const connectionState = ref<ConnectionState>('connected')
  const connectionError = ref<{ code: string; message: string } | null>(null)

  // ── Generation axis ──────────────────────────────────────────────
  const generationState = ref<GenerationState>('idle')
  const generation = ref<ActiveGeneration | null>(null)
  const transcript = ref<MessagePublic[]>([])

  // ── Other ────────────────────────────────────────────────────────
  const conversationId = ref<string | null>(null)
  const selectedModelId = ref<string | null>(loadSavedModelId())
  const retrying = ref<{ attempt: number; maxAttempts: number } | null>(null)
  const webSearchEnabled = ref<boolean>(loadSavedWebSearch())
  const searchActivity = ref<SearchActivityState | null>(null)
  const citations = ref<CitationSource[]>([])
  const reasoningEnabled = ref<boolean>(loadSavedReasoning())
  const reasoningSupported = ref<boolean>(false)
  const reasoningActive = ref<boolean>(false)
  const reasoningCompleted = ref<boolean>(false)
  const reasoningSummary = ref<string>('')
  const reasoningAvailable = computed(() => reasoningSummary.value.length > 0)

  let controller: AbortController | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let retryCount = 0
  const MAX_RETRIES = 5
  const RETRY_INTERVAL_MS = 3000

  let currentStreamConversationId: string | null = null

  // ── Computed ─────────────────────────────────────────────────
  // Only an active generation locks the input. Terminal states
  // (completed/failed/cancelled) must unlock, or a completed response
  // loaded from the DB would keep the composer disabled forever.
  const inputDisabled = computed(() => generationState.value === 'streaming')

  /**
   * Recover from a server-side model rejection (فاز ۳). The store is imported
   * lazily so this composable stays usable without an active Pinia instance
   * (e.g. in unit tests).
   */
  async function recoverFromModelRejection(code: string | undefined): Promise<boolean> {
    if (!code || !MODEL_REJECTION_CODES.has(code)) return false

    selectedModelId.value = null

    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }

    try {
      const { useModelsStore } = await import('@/stores/models')
      await useModelsStore().load(true)
    } catch {
      /* catalog refresh is best-effort; the banner still explains the rejection */
    }

    return true
  }

  // ── Connection helpers ────────────────────────────────────────────
  function setConnected(): void {
    connectionState.value = 'connected'
    connectionError.value = null
  }

  function setDisconnected(err?: Error): void {
    connectionState.value = 'disconnected'
    connectionError.value = err
      ? { code: 'network_error', message: err.message }
      : { code: 'network_error', message: 'اتصال قطع شد.' }
  }

  function setReconnecting(): void {
    connectionState.value = 'reconnecting'
  }

  // ── Online/offline listeners ─────────────────────────────────────
  function goOnline(): void {
    if (connectionState.value === 'disconnected' && generation.value?.status === 'streaming') {
      void reconnect()
    } else {
      setConnected()
    }
  }

  function goOffline(): void {
    if (generationState.value === 'streaming') {
      setDisconnected()
      startAutoRetry()
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
  }

  // ── Auto-retry ───────────────────────────────────────────────────
  function startAutoRetry(): void {
    stopAutoRetry()
    retryCount = 0
    setReconnecting()

    retryTimer = setInterval(async () => {
      if (retryCount >= MAX_RETRIES) {
        stopAutoRetry()
        setDisconnected()
        return
      }

      retryCount++

      try {
        await reconnect()
        stopAutoRetry()
        setConnected()
      } catch {
        // retry on next interval
      }
    }, RETRY_INTERVAL_MS)
  }

  function stopAutoRetry(): void {
    if (retryTimer) {
      clearInterval(retryTimer)
      retryTimer = null
    }

    retryCount = 0
  }

  // ── Dead-stream watchdog ────────────────────────────────────────
  // If the SSE connection dies silently (proxy timeout, tab throttling,
  // backend restart), generationState would stay 'streaming' forever and
  // the input stays locked. A watchdog reconciles with the DB — the
  // source of truth — when no stream activity is seen for a while.
  let lastStreamActivityAt = 0
  let watchdogTimer: ReturnType<typeof setInterval> | null = null
  const STREAM_IDLE_TIMEOUT_MS = 45_000
  const WATCHDOG_TICK_MS = 5_000

  function touchStreamActivity(): void {
    lastStreamActivityAt = Date.now()
  }

  function startWatchdog(): void {
    stopWatchdog()
    touchStreamActivity()

    watchdogTimer = setInterval(() => {
      if (generationState.value !== 'streaming') {
        stopWatchdog()
        return
      }

      if (Date.now() - lastStreamActivityAt > STREAM_IDLE_TIMEOUT_MS) {
        const convId = generation.value?.conversationId || conversationId.value

        if (convId) {
          void reconcileWithServer(convId)
        } else {
          // No ids at all (pre-start window): just release locally.
          abort()
        }

        stopWatchdog()
      }
    }, WATCHDOG_TICK_MS)
  }

  function stopWatchdog(): void {
    if (watchdogTimer) {
      clearInterval(watchdogTimer)
      watchdogTimer = null
    }
  }

  /**
   * Adopt the DB's final state for a conversation when the live stream
   * is known to be gone (resume returned no_active_stream, or the
   * watchdog fired). Unlike loadConversation, this never tries to
   * re-subscribe, so it cannot loop.
   */
  async function reconcileWithServer(convId: string): Promise<void> {
    try {
      const detail = await getConversation(convId)
      transcript.value = detail.messages
      conversationId.value = detail.id
      currentStreamConversationId = detail.id
      saveConversationId(detail.id)

      const streamingMsg = detail.messages.find(
        (m) => m.role === 'assistant' && m.status === 'streaming',
      )

      if (streamingMsg) {
        // DB still says streaming but the server stream is gone (e.g. the
        // backend restarted). Surface as failed so the recovery UI shows
        // instead of a stream that can never finish.
        generation.value = {
          conversationId: detail.id,
          assistantMessageId: streamingMsg.id,
          status: 'failed',
          content: streamingMsg.content,
        }
        generationState.value = 'failed'
      } else {
        const last = detail.messages.at(-1)

        if (last && last.role === 'assistant') {
          const st = last.status as GenerationState
          generation.value = {
            conversationId: detail.id,
            assistantMessageId: last.id,
            status: st,
            content: last.content,
          }
          generationState.value = st
        } else {
          generation.value = null
          generationState.value = 'idle'
        }
      }

      connectionError.value = null
      reasoningActive.value = false
      reasoningCompleted.value = false
      reasoningSummary.value = ''
      setConnected()
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // The conversation was deleted while we were attached to it.
        // Clear state quietly and surface the same "gone" banner.
        clearSavedConversationId()
        resetConversation()
        connectionError.value = {
          code: 'conversation_not_found',
          message: 'این گفتگو دیگر وجود ندارد (حذف شده است). می‌توانید گفتگوی جدیدی شروع کنید.',
        }
        return
      }

      setDisconnected(err instanceof Error ? err : undefined)
    }
  }

  // ── Snapshot replacement (FR-7) ──────────────────────────────────
  function replaceSnapshot(snapshot: string): void {
    if (generation.value) {
      generation.value = { ...generation.value, content: snapshot }
    }
  }

  // ── Web search (فاز ۷) ──────────────────────────────────────────────
  function setWebSearch(value: boolean): void {
    webSearchEnabled.value = value
    saveWebSearch(value)
  }

  // ── Reasoning (فاز ۸) ────────────────────────────────────────────────
  /**
   * The preference only ever applies to a reasoning-capable model: ChatView is
   * responsible for keeping `reasoningSupported` in sync with the selection.
   */
  function setReasoning(value: boolean): void {
    if (value && !reasoningSupported.value) return
    reasoningEnabled.value = value
    saveReasoning(value)
  }

  function setReasoningSupport(supported: boolean): void {
    reasoningSupported.value = supported
    if (!supported && reasoningEnabled.value) setReasoning(false)
  }

  /**
   * Reasoning phases drive only the reasoning state, so a turn can never show
   * reasoning UI that the backend did not actually report.
   */
  function applyStatus(info: SseStatus): void {
    if (info.phase === 'retrying') {
      retrying.value = {
        attempt: info.attempt ?? 1,
        maxAttempts: info.maxAttempts ?? 1,
      }
      return
    }

    if (info.phase === 'reasoning_started') {
      reasoningActive.value = true
      return
    }

    if (info.phase === 'reasoning_completed' || info.phase === 'answer_started') {
      reasoningActive.value = false
      reasoningCompleted.value = true
      return
    }

    if (info.phase === 'generating') {
      searchActivity.value = null
    } else {
      searchActivity.value = {
        phase: info.phase,
        query: info.query,
        sources: info.sources,
        credits: info.credits,
      }
    }
  }

  function applyReasoningDelta(delta: string, isFirst: boolean): void {
    reasoningSummary.value = isFirst
      ? delta
      : reasoningSummary.value + delta
  }

  function applyCitations(sources: CitationSource[]): void {
    citations.value = sources

    if (generation.value) {
      generation.value = { ...generation.value, citations: sources }
    }

    const idx = transcript.value.findIndex(
      (m) => m.id === generation.value?.assistantMessageId,
    )

    if (idx !== -1) {
      transcript.value = [
        ...transcript.value.slice(0, idx),
        { ...transcript.value[idx], citations: sources },
        ...transcript.value.slice(idx + 1),
      ]
    }
  }

  // ── Cancel (FR-10) ───────────────────────────────────────────────
  async function cancel(): Promise<void> {
    stopAutoRetry()

    if (!generation.value) return

    // The optimistic placeholder may have an empty conversationId when
    // the server's start event has not arrived yet (brand-new chat).
    // Prefer the real id, then the route/store id; if we have neither,
    // tear the stream down locally — the backend will finish-or-fail the
    // request on its own but the client must not stay locked.
    const convId = generation.value.conversationId || conversationId.value

    if (!convId) {
      abort()
      return
    }

    try {
      const res = await cancelGeneration(convId)
      const serverStatus = res.status as GenerationState

      generation.value = { ...generation.value, status: serverStatus }
      generationState.value = serverStatus

      // The server has marked the row cancelled and broadcast to
      // subscribers; close our SSE connection — no further events matter.
      stopWatchdog()

      if (controller) {
        controller.abort()
        controller = null
      }
    } catch (err) {
      const apiErr = err as ApiError

      if (apiErr.code === 'no_active_generation') {
        if (conversationId.value) {
          await loadConversation(conversationId.value)
        }
      } else {
        connectionError.value = {
          code: apiErr.code ?? 'cancel_failed',
          message: streamErrorMessage(apiErr.code ?? 'cancel_failed', apiErr.message),
        }
      }
    }
  }

  // ── Retry (FR-11) ────────────────────────────────────────────────
  // Retries the most recent failed/cancelled assistant message as a live
  // SSE stream. Works after refresh too: the failed message is resolved
  // from the transcript (DB state), not from in-memory generation state,
  // and missing context surfaces an error instead of failing silently.
  async function retry(targetMessageId?: string): Promise<void> {
    if (generationState.value === 'streaming') return

    const convId = conversationId.value ?? generation.value?.conversationId

    if (!convId) {
      connectionError.value = {
        code: 'conversation_not_found',
        message: 'ابتدا گفتگو را باز کنید، سپس تلاش مجدد بزنید.',
      }
      return
    }

    // Prefer an explicitly targeted row (the button knows its message),
    // then the failed generation's own message, then the newest
    // failed/cancelled assistant row from the transcript.
    const isRetryable = (m: MessagePublic) =>
      m.role === 'assistant' &&
      (m.status === 'failed' || m.status === 'cancelled')

    const targeted = targetMessageId
      ? transcript.value.find((m) => m.id === targetMessageId && isRetryable(m))
      : undefined

    const fromGeneration =
      generation.value &&
      (generation.value.status === 'failed' || generation.value.status === 'cancelled')
        ? transcript.value.find((m) => m.id === generation.value!.assistantMessageId)
        : null

    const failedMsg =
      targeted ??
      fromGeneration ??
      [...transcript.value].reverse().find(isRetryable)

    if (!failedMsg) {
      connectionError.value = {
        code: 'message_not_found',
        message: 'پیام قابل تلاش مجدد پیدا نشد.',
      }
      return
    }

    // Optimistic streaming state; the server's real ids arrive via onStart.
    // `retriedRowId` remembers which transcript row this retry replaces.
    const retriedRowId = failedMsg.id

    generation.value = {
      conversationId: convId,
      assistantMessageId: `assistant-${Date.now()}`,
      status: 'streaming',
      content: '',
    }

    generationState.value = 'streaming'
    connectionError.value = null
    reasoningActive.value = false
    reasoningCompleted.value = false
    reasoningSummary.value = ''

    const handlers: StreamHandlers = {
      onStart: makeOnStart(retriedRowId),
      onStatus: applyStatus,
      onCitations: applyCitations,
      onReasoningDelta: applyReasoningDelta,
      onDelta: (_delta: string, _isFirst: boolean) => {
        touchStreamActivity()

        if (!generation.value) return

        const newContent = generation.value.content + _delta
        generation.value = { ...generation.value, content: newContent }

        const idx = transcript.value.findIndex(
          (m) => m.id === generation.value!.assistantMessageId,
        )

        if (idx !== -1) {
          transcript.value = [
            ...transcript.value.slice(0, idx),
            { ...transcript.value[idx], content: newContent },
            ...transcript.value.slice(idx + 1),
          ]
        }

        retrying.value = null
      },
      onDone: async () => {
        retrying.value = null
        searchActivity.value = null
        reasoningActive.value = false

        if (generation.value) {
          generation.value = { ...generation.value, status: 'completed' }

          const idx = transcript.value.findIndex(
            (m) => m.id === generation.value!.assistantMessageId,
          )

          if (idx !== -1) {
            transcript.value = [
              ...transcript.value.slice(0, idx),
              { ...transcript.value[idx], status: 'completed' as const },
              ...transcript.value.slice(idx + 1),
            ]
          }
        }

        generationState.value = 'completed'
        controller = null
        stopWatchdog()
      },
      onError: (err) => {
        connectionError.value = err
        retrying.value = null
        searchActivity.value = null

        // A failed or cancelled turn has no live reasoning state, even when
        // the provider had already streamed part of a summary.
        reasoningActive.value = false

        if (generation.value) {
          if (err.code === 'generation_cancelled') {
            generation.value = { ...generation.value, status: 'cancelled' }
          } else {
            generation.value = { ...generation.value, status: 'failed' }
          }

          const idx = transcript.value.findIndex(
            (m) => m.id === generation.value!.assistantMessageId,
          )

          if (idx !== -1) {
            transcript.value = [
              ...transcript.value.slice(0, idx),
              {
                ...transcript.value[idx],
                status:
                  err.code === 'generation_cancelled'
                    ? ('cancelled' as const)
                    : ('failed' as const),
              },
              ...transcript.value.slice(idx + 1),
            ]
          }
        }

        generationState.value =
          err.code === 'generation_cancelled' ? 'cancelled' : 'failed'

        controller = null
        stopWatchdog()
        void recoverFromModelRejection(err.code)
      },
    }

    controller = retryStream(convId, failedMsg.id, handlers, {
      webSearch: webSearchEnabled.value,
      // A retry must keep the caller's reasoning choice: silently dropping it
      // would produce a different answer than the one being retried.
      reasoning: reasoningEnabled.value && reasoningSupported.value,
    })

    startWatchdog()
  }

  async function reconnect(): Promise<void> {
    if (!conversationId.value || !generation.value) return

    stopAutoRetry()
    setReconnecting()
    controller?.abort()

    try {
      const detail = await getConversation(conversationId.value)
      transcript.value = detail.messages

      const streamingMsg = detail.messages.find(
        (m) => m.role === 'assistant' && m.status === 'streaming',
      )

      if (streamingMsg) {
        generation.value = {
          conversationId: detail.id,
          assistantMessageId: streamingMsg.id,
          status: 'streaming',
          content: streamingMsg.content,
        }

        generationState.value = 'streaming'
        saveConversationId(detail.id)

        await startResumeStream(
          detail.id,
          streamingMsg.id,
          streamingMsg.content,
        )
      } else {
        const finalMsg = detail.messages.at(-1)

        if (finalMsg?.role === 'assistant') {
          const finalStatus = finalMsg.status as GenerationState

          generation.value = {
            conversationId: detail.id,
            assistantMessageId: finalMsg.id,
            status: finalStatus,
            content: finalMsg.content,
          }

          generationState.value = finalStatus
        } else {
          generation.value = null
          generationState.value = 'idle'
        }
      }

      setConnected()
    } catch (err) {
      setDisconnected(err instanceof Error ? err : undefined)
    }
  }

  async function startResumeStream(
    convId: string,
    _assistantMsgId: string,
    _existingContent: string,
  ): Promise<void> {
    controller = resumeStream(convId, {
      onStatus: applyStatus,
      onCitations: applyCitations,
      onReasoningDelta: applyReasoningDelta,
      onDelta: (_text: string, isFirst: boolean) => {
        touchStreamActivity()

        if (!generation.value) return

        const newContent = isFirst
          ? _text
          : generation.value.content + _text

        generation.value = { ...generation.value, content: newContent }

        const idx = transcript.value.findIndex(
          (m) => m.id === generation.value!.assistantMessageId,
        )

        if (idx !== -1) {
          transcript.value = [
            ...transcript.value.slice(0, idx),
            { ...transcript.value[idx], content: newContent },
            ...transcript.value.slice(idx + 1),
          ]
        }
      },
      onDone: () => {
        if (generation.value) {
          generation.value = { ...generation.value, status: 'completed' }

          const idx = transcript.value.findIndex(
            (m) => m.id === generation.value!.assistantMessageId,
          )

          if (idx !== -1) {
            transcript.value = [
              ...transcript.value.slice(0, idx),
              { ...transcript.value[idx], status: 'completed' as const },
              ...transcript.value.slice(idx + 1),
            ]
          }
        }

        generationState.value = 'completed'
        controller = null
        stopWatchdog()
      },
      onError: (err) => {
        if (
          err.code === 'no_active_stream' ||
          err.code === 'generation_cancelled'
        ) {
          // The server stream is gone — reconcile with the DB instead of
          // inventing a local state. This resolves the refresh/mid-stream
          // race where the stream finished while the page was reloading.
          void reconcileWithServer(convId)
        } else {
          connectionError.value = err

          if (generation.value) {
            generation.value = { ...generation.value, status: 'failed' }

            const idx = transcript.value.findIndex(
              (m) => m.id === generation.value!.assistantMessageId,
            )

            if (idx !== -1) {
              transcript.value = [
                ...transcript.value.slice(0, idx),
                { ...transcript.value[idx], status: 'failed' as const },
                ...transcript.value.slice(idx + 1),
              ]
            }
          }

          generationState.value = 'failed'
        }

        controller = null
        stopWatchdog()
      },
    })

    startWatchdog()
  }

  async function loadConversation(id: string): Promise<void> {
    // Already streaming this exact conversation (e.g. the route just
    // caught up to the id adopted via onStart) — reloading would tear
    // down and re-subscribe the live stream. Skip.
    if (
      generationState.value === 'streaming' &&
      generation.value?.conversationId === id
    ) {
      return
    }

    connectionError.value = null
    searchActivity.value = null
    citations.value = []
    reasoningActive.value = false
    reasoningCompleted.value = false
    reasoningSummary.value = ''
    setConnected()

    try {
      const detail = await getConversation(id)
      transcript.value = detail.messages
      conversationId.value = detail.id
      currentStreamConversationId = detail.id
      saveConversationId(detail.id)

      // Sync the picker to the conversation's persisted model so reloading
      // a conversation restores the user's previous selection.
      if (detail.modelId && detail.modelId !== selectedModelId.value) {
        selectedModelId.value = detail.modelId
        saveModelId(detail.modelId)
      }

      const streamingMsg = detail.messages.find(
        (m) => m.role === 'assistant' && m.status === 'streaming',
      )

      if (streamingMsg) {
        generation.value = {
          conversationId: detail.id,
          assistantMessageId: streamingMsg.id,
          status: 'streaming',
          content: streamingMsg.content,
        }

        generationState.value = 'streaming'

        await startResumeStream(
          detail.id,
          streamingMsg.id,
          streamingMsg.content,
        )
      } else {
        generation.value = null
        generationState.value = 'idle'
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null

      if (apiErr?.status === 404) {
        // The conversation was hard-deleted (or the stored id points to
        // another user's data). Clear the stale id so the stored-id
        // redirect loop can't re-fire, drop local state, and tell the
        // user clearly instead of pretending the network died.
        clearSavedConversationId()
        resetConversation()
        connectionError.value = {
          code: 'conversation_not_found',
          message: 'این گفتگو دیگر وجود ندارد (حذف شده است). می‌توانید گفتگوی جدیدی شروع کنید.',
        }
        return
      }

      connectionError.value = apiErr
        ? { code: apiErr.code, message: apiErr.message }
        : { code: 'network_error', message: 'خطا در بارگذاری گفتگو.' }

      setDisconnected()
    }
  }

  function resetConversation(): void {
    abort()
    transcript.value = []
    conversationId.value = null
    currentStreamConversationId = null
    clearSavedConversationId()
    generation.value = null
    generationState.value = 'idle'
    connectionState.value = 'connected'
    connectionError.value = null
    searchActivity.value = null
    citations.value = []
    reasoningActive.value = false
    reasoningCompleted.value = false
    reasoningSummary.value = ''
  }

  /**
   * Builds the shared `onStart` handler: adopt the server-assigned ids and
   * re-key the optimistic transcript rows. When `replaceRowId` is set (a retry),
   * the already-persisted failed/cancelled row is replaced in place, so the
   * transcript shows the regenerated answer instead of the stale row.
   */
  function makeOnStart(replaceRowId: string | null) {
    return (info: StreamStartInfo): void => {
      // The server assigns the real conversation + assistant message ids
      // once the DB rows exist. Adopt them so deltas sync into the
      // transcript, cancel hits the right conversation, and the router can
      // update the URL — all before the first token arrives.
      conversationId.value = info.conversationId
      currentStreamConversationId = info.conversationId
      saveConversationId(info.conversationId)

      if (
        generation.value &&
        generation.value.assistantMessageId !== info.assistantMessageId
      ) {
        const oldId = generation.value.assistantMessageId

        generation.value = {
          ...generation.value,
          conversationId: info.conversationId,
          assistantMessageId: info.assistantMessageId,
        }

        // Re-key the optimistic transcript rows to the real ids.
        const userIdx = transcript.value.findIndex(
          (m) => m.id === `user-${oldId.slice('assistant-'.length)}`,
        )

        if (userIdx !== -1) {
          transcript.value = [
            ...transcript.value.slice(0, userIdx),
            {
              ...transcript.value[userIdx],
              id: `user-${info.assistantMessageId}`,
            },
            ...transcript.value.slice(userIdx + 1),
          ]
        }

        if (replaceRowId) {
          const retriedIdx = transcript.value.findIndex(
            (m) => m.id === replaceRowId,
          )

          if (retriedIdx !== -1) {
            transcript.value = [
              ...transcript.value.slice(0, retriedIdx),
              {
                ...transcript.value[retriedIdx],
                id: info.assistantMessageId,
                content: '',
                status: 'streaming',
              },
              ...transcript.value.slice(retriedIdx + 1),
            ]
          }
        }
      }

      touchStreamActivity()
    }
  }

  async function send(
    text: string,
    opts?: { fileId?: string | null; file?: MessagePublic['file'] },
  ): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return Promise.resolve()

    if (generationState.value === 'streaming') {
      connectionError.value = {
        code: 'generation_in_progress',
        message: streamErrorMessage('generation_in_progress'),
      }
      return Promise.resolve()
    }

    const modelId = selectedModelId.value

    if (!modelId) {
      connectionError.value = {
        code: 'no_model_selected',
        message: 'لطفاً یک مدل انتخاب کنید.',
      }
      return Promise.resolve()
    }

    const fileId = opts?.fileId?.trim() || null

    generation.value = null
    generationState.value = 'idle'
    connectionError.value = null
    retrying.value = null
    searchActivity.value = null
    citations.value = []
    reasoningActive.value = false
    reasoningCompleted.value = false
    reasoningSummary.value = ''

    const targetConversationId = conversationId.value

    if (targetConversationId) {
      saveConversationId(targetConversationId)
    }

    const handlers: StreamHandlers = {
      onStart: makeOnStart(null),
      onStatus: applyStatus,
      onCitations: applyCitations,
      onReasoningDelta: applyReasoningDelta,
      onDelta: (_delta: string, _isFirst: boolean) => {
        touchStreamActivity()

        if (!generation.value) return

        const newContent = generation.value.content + _delta
        generation.value = {
          ...generation.value,
          content: newContent,
        }

        const idx = transcript.value.findIndex(
          (m) => m.id === generation.value!.assistantMessageId,
        )

        if (idx !== -1) {
          transcript.value = [
            ...transcript.value.slice(0, idx),
            { ...transcript.value[idx], content: newContent },
            ...transcript.value.slice(idx + 1),
          ]
        }

        retrying.value = null
      },
      onDone: async () => {
        retrying.value = null
        searchActivity.value = null
        reasoningActive.value = false

        if (generation.value) {
          generation.value = {
            ...generation.value,
            status: 'completed',
          }

          const idx = transcript.value.findIndex(
            (m) => m.id === generation.value!.assistantMessageId,
          )

          if (idx !== -1) {
            transcript.value = [
              ...transcript.value.slice(0, idx),
              { ...transcript.value[idx], status: 'completed' as const },
              ...transcript.value.slice(idx + 1),
            ]
          }
        }

        generationState.value = 'completed'
        controller = null
        stopWatchdog()

        if (!conversationId.value) {
          const id = await findLatestConversationId()

          if (id) {
            conversationId.value = id
            currentStreamConversationId = id
            saveConversationId(id)
          }
        }
      },
      onError: (err) => {
        connectionError.value = err
        retrying.value = null
        searchActivity.value = null

        // A failed or cancelled turn has no live reasoning state, even when
        // the provider had already streamed part of a summary.
        reasoningActive.value = false

        if (generation.value) {
          if (err.code === 'generation_cancelled') {
            generation.value = {
              ...generation.value,
              status: 'cancelled',
            }
          } else {
            generation.value = {
              ...generation.value,
              status: 'failed',
            }
          }

          const idx = transcript.value.findIndex(
            (m) => m.id === generation.value!.assistantMessageId,
          )

          if (idx !== -1) {
            transcript.value = [
              ...transcript.value.slice(0, idx),
              {
                ...transcript.value[idx],
                status:
                  err.code === 'generation_cancelled'
                    ? ('cancelled' as const)
                    : ('failed' as const),
              },
              ...transcript.value.slice(idx + 1),
            ]
          }
        }

        generationState.value =
          err.code === 'generation_cancelled' ? 'cancelled' : 'failed'

        controller = null
        stopWatchdog()
        void recoverFromModelRejection(err.code)
      },
    }

    controller = streamChat(
      {
        conversationId: targetConversationId,
        modelId,
        message: trimmed,
        fileId,
        webSearch: webSearchEnabled.value,
        reasoning: reasoningEnabled.value && reasoningSupported.value,
      },
      handlers,
    )

    startWatchdog()

    // Optimistically create the assistant message placeholder. The user
    // row shares the same timestamp so onStart can re-key both to the
    // server-assigned ids as a pair.
    const optimisticId = String(Date.now())
    const assistantMsgId = `assistant-${optimisticId}`

    generation.value = {
      conversationId: targetConversationId ?? '',
      assistantMessageId: assistantMsgId,
      status: 'streaming',
      content: '',
    }

    generationState.value = 'streaming'

    // Add user message to transcript immediately with file option.
    transcript.value.push({
      id: `user-${optimisticId}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
      status: 'completed',
      file: opts?.file ?? null,
    })

    return Promise.resolve()
  }

  function abort(): void {
    stopWatchdog()

    if (controller) {
      controller.abort()
      controller = null
    }

    if (generationState.value === 'streaming' && generation.value) {
      generation.value = {
        ...generation.value,
        status: 'cancelled',
      }
      generationState.value = 'cancelled'
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function saveConversationId(id: string | null): void {
    try {
      if (id) {
        localStorage.setItem(CONVERSATION_KEY, id)
      }
    } catch {
      /* ignore */
    }
  }

  /** Remove the persisted last-conversation id (used when it points to a
   *  conversation that no longer exists, or after the user deletes it). */
  function clearSavedConversationId(): void {
    try {
      localStorage.removeItem(CONVERSATION_KEY)
    } catch {
      /* ignore */
    }
  }

  function loadSavedConversationId(): string | null {
    try {
      return localStorage.getItem(CONVERSATION_KEY)
    } catch {
      return null
    }
  }

  async function findLatestConversationId(): Promise<string | null> {
    try {
      const result = await listConversations()

      const latest = Array.isArray(result)
        ? result[0]
        : result.items?.[0]

      return latest?.id ?? null
    } catch {
      return null
    }
  }

  async function setModel(id: string | null): Promise<void> {
    // Guard programmatic calls; the picker is already disabled in the UI
    // but this prevents a stray setModel during streaming from mutating
    // state mid-turn.
    if (generationState.value === 'streaming') return

    selectedModelId.value = id

    if (id) {
      saveModelId(id)
    } else {
      try {
        sessionStorage.removeItem(SESSION_KEY)
      } catch {
        /* ignore */
      }
    }

    // If a conversation is loaded, persist the choice server-side so the
    // active model survives reload and follows the user across devices.
    // Errors are surfaced but non-blocking — the in-memory selection
    // still drives the next chat request.
    const convId = conversationId.value

    if (convId && id) {
      try {
        await setConversationModel(convId, id)
      } catch (err) {
        const apiErr = err as ApiError

        connectionError.value = {
          code: apiErr.code ?? 'set_model_failed',
          message: streamErrorMessage(
            apiErr.code ?? 'set_model_failed',
            apiErr.message,
          ),
        }

        await recoverFromModelRejection(apiErr.code)
      }
    }
  }

  onBeforeUnmount(() => {
    stopAutoRetry()
    stopWatchdog()

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }

    abort()
  })

  return {
    connectionState,
    connectionError,
    generationState,
    generation,
    transcript,
    conversationId,
    selectedModelId,
    inputDisabled,
    retrying,
    webSearchEnabled,
    searchActivity,
    citations,
    reasoningEnabled,
    reasoningSupported,
    reasoningActive,
    reasoningCompleted,
    reasoningSummary,
    reasoningAvailable,
    setWebSearch,
    setReasoning,
    setReasoningSupport,
    setModel,
    loadConversation,
    resetConversation,
    send,
    abort,
    replaceSnapshot,
    cancel,
    retry,
    reconnect,
    clearSavedConversationId,
    loadSavedConversationId,
  }
}