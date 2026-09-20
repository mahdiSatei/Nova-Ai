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
  const inputDisabled = computed(() => generationState.value === 'streaming')

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
      /* catalog refresh is best-effort */
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

  async function reconcileWithServer(convId: string): Promise<void> {
    try {
      const detail = await getConversation(convId)
      transcript.value = detail.messages
      conversationId.value = detail.id
      saveConversationId(detail.id)

      const streamingMsg = detail.messages.find(
        (m) => m.role === 'assistant' && m.status === 'streaming',
      )

      if (streamingMsg) {
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

  function replaceSnapshot(snapshot: string): void {
    if (generation.value) {
      generation.value = { ...generation.value, content: snapshot }
    }
  }

  function setWebSearch(value: boolean): void {
    webSearchEnabled.value = value
    saveWebSearch(value)
  }

  function setReasoning(value: boolean): void {
    if (value && !reasoningSupported.value) return
    reasoningEnabled.value = value
    saveReasoning(value)
  }

  function setReasoningSupport(supported: boolean): void {
    reasoningSupported.value = supported
    if (!supported && reasoningEnabled.value) setReasoning(false)
  }

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

  async function cancel(): Promise<void> {
    stopAutoRetry()

    if (!generation.value) return

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
            } else {
              transcript.value.push({
                id: generation.value.assistantMessageId,
                role: 'assistant',
                content: generation.value.content,
                createdAt: new Date().toISOString(),
                status: 'completed' as const,
              })
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
      saveConversationId(detail.id)

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

  function makeOnStart(replaceRowId: string | null) {
    return (info: StreamStartInfo): void => {
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
        conversationId: targetConversationId ?? undefined,
        modelId: modelId ?? undefined,
        message: trimmed,
        fileId,
        webSearch: webSearchEnabled.value,
        reasoning: reasoningEnabled.value && reasoningSupported.value,
      },
      handlers,
    )

    startWatchdog()

    const optimisticId = String(Date.now())
    const assistantMsgId = `assistant-${optimisticId}`

    generation.value = {
      conversationId: targetConversationId ?? '',
      assistantMessageId: assistantMsgId,
      status: 'streaming',
      content: '',
    }

    generationState.value = 'streaming'

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

  function saveConversationId(id: string | null): void {
    try {
      if (id) {
        localStorage.setItem(CONVERSATION_KEY, id)
      }
    } catch {
      /* ignore */
    }
  }

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