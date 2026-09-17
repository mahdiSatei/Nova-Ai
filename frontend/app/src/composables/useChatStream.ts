// Composable مرکزی چت: dual state model — connection + generation.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { streamChat, resumeStream, retryStream, cancelGeneration, type StreamHandlers } from '@/api/chat'
import { getConversation, listConversations } from '@/api/conversations'
import { ApiError } from '@/api/http'
import { streamErrorMessage } from '@/utils/errors'
import type { MessagePublic } from '@/types/api'

const SESSION_KEY = 'mmcb.lastModelId'
const CONVERSATION_KEY = 'mmcb.lastConversationId'

type ConnectionState = 'connected' | 'disconnected' | 'reconnecting'
type GenerationState = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled'

interface ActiveGeneration {
  conversationId: string
  assistantMessageId: string
  status: GenerationState
  content: string
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

export interface ChatStreamHandle {
  connectionState: import('vue').Ref<ConnectionState>
  generationState: import('vue').Ref<GenerationState>
  generation: import('vue').Ref<ActiveGeneration | null>
  transcript: import('vue').Ref<MessagePublic[]>
  conversationId: import('vue').Ref<string | null>
  selectedModelId: import('vue').Ref<string | null>
  inputDisabled: import('vue').ComputedRef<boolean>
  setModel: (id: string | null) => void
  loadConversation: (id: string) => Promise<void>
  resetConversation: () => void
  send: (text: string) => Promise<void>
  abort: () => void
  replaceSnapshot: (snapshot: string) => void
  cancel: () => Promise<void>
  retry: () => Promise<void>
  reconnect: () => Promise<void>
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

  let controller: AbortController | null = null
  let currentStreamConversationId: string | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let retryCount = 0
  const MAX_RETRIES = 5
  const RETRY_INTERVAL_MS = 3000

  // ── Computed ─────────────────────────────────────────────────
  // Only an active generation locks the input. Terminal states
  // (completed/failed/cancelled) must unlock, or a completed response
  // loaded from the DB would keep the composer disabled forever.
  const inputDisabled = computed(() => generationState.value === 'streaming')

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
      reconnect()
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
        // Backend says nothing is active — reload to reconcile
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
      m.role === 'assistant' && (m.status === 'failed' || m.status === 'cancelled')
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
    generation.value = {
      conversationId: convId,
      assistantMessageId: `assistant-${Date.now()}`,
      status: 'streaming',
      content: '',
    }
    generationState.value = 'streaming'
    connectionError.value = null

    const handlers: StreamHandlers = {
      onStart: (info) => {
        currentStreamConversationId = info.conversationId
        saveConversationId(info.conversationId)
        if (generation.value) {
          generation.value = {
            ...generation.value,
            conversationId: info.conversationId,
            assistantMessageId: info.assistantMessageId,
          }
          // Replace the specific retried failed/cancelled row with a live
          // row for the new attempt. Use failedMsg.id (the exact message the
          // user retried) rather than findIndex(any failed) so we don't
          // accidentally replace a different failed message, and so cancelled
          // messages are handled too.
          const prevFailedIdx = transcript.value.findIndex(
            (m) => m.id === failedMsg.id,
          )
          const liveRow: Message = {
            id: info.assistantMessageId,
            role: 'assistant',
            content: generation.value.content,
            createdAt: new Date().toISOString(),
            status: 'streaming',
          }
          if (!transcript.value.some((m) => m.id === info.assistantMessageId)) {
            transcript.value =
              prevFailedIdx !== -1
                ? [
                    ...transcript.value.slice(0, prevFailedIdx),
                    liveRow,
                    ...transcript.value.slice(prevFailedIdx + 1),
                  ]
                : [...transcript.value, liveRow]
          }
        }
        touchStreamActivity()
      },
      onDelta: (delta: string) => {
        touchStreamActivity()
        if (!generation.value) return
        const newContent = generation.value.content + delta
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
        if (err.code === 'generation_cancelled') {
          if (generation.value) {
            generation.value = { ...generation.value, status: 'cancelled' }
            const idx = transcript.value.findIndex(
              (m) => m.id === generation.value!.assistantMessageId,
            )
            if (idx !== -1) {
              transcript.value = [
                ...transcript.value.slice(0, idx),
                { ...transcript.value[idx], status: 'cancelled' as const },
                ...transcript.value.slice(idx + 1),
              ]
            }
          }
          generationState.value = 'cancelled'
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
    }

    controller = retryStream(convId, failedMsg.id, handlers)
    startWatchdog()
  }

  // ── Reconnect (FR-6) ─────────────────────────────────────────────
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
        await startResumeStream(detail.id, streamingMsg.id, streamingMsg.content)
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

  // ── Resume stream ────────────────────────────────────────────────
  async function startResumeStream(
    convId: string,
    assistantMsgId: string,
    existingContent: string,
  ): Promise<void> {
    // Use the dedicated resume endpoint — it subscribes to the
    // in-progress in-memory stream instead of creating a new generation.
    // The first delta from the backend is the full accumulated text;
    // subsequent deltas are incremental live tokens.
    controller = resumeStream(
      convId,
      {
        onDelta: (_text: string, isFirst: boolean) => {
          touchStreamActivity()
          if (!generation.value) return
          const newContent = isFirst ? _text : generation.value.content + _text
          generation.value = { ...generation.value, content: newContent }
          // Sync into transcript for MessageList rendering.
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
        },
        onError: (err) => {
          if (err.code === 'no_active_stream' || err.code === 'generation_cancelled') {
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
      },
    )
    startWatchdog()
  }

  // ── Load conversation (FR-1, FR-9) ───────────────────────────────
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
    console.debug('[useChatStream] loadConversation start', { id })
    connectionError.value = null
    setConnected()
    try {
      const detail = await getConversation(id)
      console.debug('[useChatStream] loadConversation got detail', { messageCount: detail.messages.length, conversationId: detail.id })
      transcript.value = detail.messages
      conversationId.value = detail.id
      currentStreamConversationId = detail.id
      saveConversationId(detail.id)

      const streamingMsg = detail.messages.find(
        (m) => m.role === 'assistant' && m.status === 'streaming',
      )

      if (streamingMsg) {
        console.debug('[useChatStream] loadConversation found streaming msg', { msgId: streamingMsg.id, contentLength: streamingMsg.content.length })
        generation.value = {
          conversationId: detail.id,
          assistantMessageId: streamingMsg.id,
          status: 'streaming',
          content: streamingMsg.content,
        }
        generationState.value = 'streaming'
        // Auto-resume: tap into the in-memory stream instead of showing a frozen UI.
        await startResumeStream(detail.id, streamingMsg.id, streamingMsg.content)
      } else {
        generation.value = null
        generationState.value = 'idle'
      }
    } catch (err) {
      console.debug('[useChatStream] loadConversation error', err)
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

  // ── Reset ────────────────────────────────────────────────────────
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
  }

  // ── Send (FR-2, FR-3) ────────────────────────────────────────────
  async function send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return Promise.resolve()

    // FR-3: guard against concurrent generation
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

    // Reset generation state
    generation.value = null
    generationState.value = 'idle'
    connectionError.value = null

    const targetConversationId = conversationId.value
    currentStreamConversationId = targetConversationId
    if (targetConversationId) saveConversationId(targetConversationId)

    const handlers: StreamHandlers = {
      // The server assigns the real conversation + assistant message ids
      // once the DB rows exist. Adopt them so deltas sync into the
      // transcript, cancel hits the right conversation, and the router can
      // update the URL — all before the first token arrives.
      onStart: (info) => {
        conversationId.value = info.conversationId
        currentStreamConversationId = info.conversationId
        saveConversationId(info.conversationId)
        if (generation.value && generation.value.assistantMessageId !== info.assistantMessageId) {
          const oldId = generation.value.assistantMessageId
          generation.value = {
            ...generation.value,
            conversationId: info.conversationId,
            assistantMessageId: info.assistantMessageId,
          }
          // Re-key the optimistic transcript rows to the real ids.
          const userIdx = transcript.value.findIndex((m) => m.id === `user-${oldId.slice('assistant-'.length)}`)
          if (userIdx !== -1) {
            transcript.value = [
              ...transcript.value.slice(0, userIdx),
              { ...transcript.value[userIdx], id: `user-${info.assistantMessageId}` },
              ...transcript.value.slice(userIdx + 1),
            ]
          }
        }
        touchStreamActivity()
      },
      onDelta: (_delta: string, _isFirst: boolean) => {
        touchStreamActivity()
        if (generation.value) {
          generation.value = {
            ...generation.value,
            content: generation.value.content + _delta,
          }
          // Sync the live content into the transcript so MessageList
          // (which renders from transcript) reflects the new text.
          const idx = transcript.value.findIndex(
            (m) => m.id === generation.value!.assistantMessageId,
          )
          if (idx !== -1) {
            transcript.value = [
              ...transcript.value.slice(0, idx),
              { ...transcript.value[idx], content: generation.value.content },
              ...transcript.value.slice(idx + 1),
            ]
          }
        }
      },
      onDone: async () => {
        if (generation.value) {
          generation.value = { ...generation.value, status: 'completed' }
          // Mark the transcript message as completed so recovery UI clears.
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
            saveConversationId(id)
          }
        }
      },
      onError: (err) => {
        if (err.code === 'generation_cancelled') {
          // Cancel was confirmed server-side (possibly from another
          // tab/device). Show cancelled state, no error banner.
          if (generation.value) {
            generation.value = { ...generation.value, status: 'cancelled' }
            const idx = transcript.value.findIndex(
              (m) => m.id === generation.value!.assistantMessageId,
            )
            if (idx !== -1) {
              transcript.value = [
                ...transcript.value.slice(0, idx),
                { ...transcript.value[idx], status: 'cancelled' as const },
                ...transcript.value.slice(idx + 1),
              ]
            }
          }
          generationState.value = 'cancelled'
        } else {
          connectionError.value = err
          if (generation.value) {
            generation.value = { ...generation.value, status: 'failed' }
            // Mark the transcript message as failed.
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
    }

    controller = streamChat(
      {
        conversationId: targetConversationId,
        modelId,
        message: trimmed,
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

    // Add user message to transcript immediately
    transcript.value.push({
      id: `user-${optimisticId}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
      status: 'completed',
    })

    return Promise.resolve()
  }

  // ── Abort ────────────────────────────────────────────────────────
  function abort(): void {
    stopWatchdog()
    if (controller) {
      controller.abort()
      controller = null
    }
    if (generationState.value === 'streaming' && generation.value) {
      generation.value = { ...generation.value, status: 'cancelled' }
      generationState.value = 'cancelled'
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────
  async function findLatestConversationId(): Promise<string | null> {
    try {
      const page = await listConversations({ limit: 1 })
      return page.items[0]?.id ?? null
    } catch {
      return null
    }
  }

  function saveConversationId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CONVERSATION_KEY, id)
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

function setModel(id: string | null): void {
    selectedModelId.value = id
    if (id) saveModelId(id)
    else {
      try {
        sessionStorage.removeItem(SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────
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
