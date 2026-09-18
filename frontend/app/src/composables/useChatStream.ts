// Composable مرکزی چت: dual state model — connection + generation.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { streamChat, resumeStream, type StreamHandlers } from '@/api/chat'
import { cancelGeneration, retryGeneration } from '@/api/chat'
import { getConversation, listConversations, setConversationModel } from '@/api/conversations'
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

/**
 * Codes that mean "the model this client holds is not usable by this account".
 * When one arrives, drop the selection and reload the entitlement-filtered
 * catalog so the picker repopulates with what is actually available.
 */
const MODEL_REJECTION_CODES = new Set(['model_forbidden', 'model_unavailable'])

export interface ChatStreamHandle {
  connectionState: import('vue').Ref<ConnectionState>
  generationState: import('vue').Ref<GenerationState>
  generation: import('vue').Ref<ActiveGeneration | null>
  transcript: import('vue').Ref<MessagePublic[]>
  conversationId: import('vue').Ref<string | null>
  selectedModelId: import('vue').Ref<string | null>
  inputDisabled: import('vue').ComputedRef<boolean>
  /** Non-null while the server retries or fails over before the first token (فاز ۶). */
  retrying: import('vue').Ref<{ attempt: number; maxAttempts: number } | null>
  setModel: (id: string | null) => Promise<void>
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
  const retrying = ref<{ attempt: number; maxAttempts: number } | null>(null)

  let controller: AbortController | null = null
  let currentStreamConversationId: string | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let retryCount = 0
  const MAX_RETRIES = 5
  const RETRY_INTERVAL_MS = 3000

  // ── Computed ─────────────────────────────────────────────────────
  const inputDisabled = computed(
    () => generationState.value === 'streaming' || generationState.value === 'completed',
  )

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

    const convId = generation.value.conversationId
    try {
      const res = await cancelGeneration(convId)
      const serverStatus = res.status as GenerationState
      generation.value = { ...generation.value, status: serverStatus }
      generationState.value = serverStatus
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
  async function retry(): Promise<void> {
    if (!conversationId.value || !generation.value) return

    const failedMessageId = generation.value.assistantMessageId
    const lastUserMsg = transcript.value.filter((m) => m.role === 'user').at(-1)

    try {
      await retryGeneration(conversationId.value, failedMessageId)
      // Reset generation state; the stream will pick up via loadConversation or a new send
      generation.value = null
      generationState.value = 'idle'

      if (lastUserMsg) {
        await send(lastUserMsg.content)
      }
    } catch (err) {
      const apiErr = err as ApiError
      generationState.value = 'failed'
      connectionError.value = {
        code: apiErr.code ?? 'retry_failed',
        message: streamErrorMessage(apiErr.code ?? 'retry_failed', apiErr.message),
      }
    }
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
          controller = null
        },
      },
    )
  }

  // ── Load conversation (FR-1, FR-9) ───────────────────────────────
  async function loadConversation(id: string): Promise<void> {
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

      // Sync the picker to the conversation's persisted model so reloading
      // a conversation restores the user's previous selection.
      if (detail.modelId && detail.modelId !== selectedModelId.value) {
        selectedModelId.value = detail.modelId
      }

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
    saveConversationId(null)
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
    retrying.value = null

    const targetConversationId = conversationId.value
    currentStreamConversationId = targetConversationId
    if (targetConversationId) saveConversationId(targetConversationId)

    const handlers: StreamHandlers = {
      onStatus: (info) => {
        retrying.value = { attempt: info.attempt, maxAttempts: info.maxAttempts }
      },
      onDelta: (_delta: string, _isFirst: boolean) => {
        retrying.value = null
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
        retrying.value = null
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

        if (!conversationId.value) {
          const id = await findLatestConversationId()
          if (id) {
            conversationId.value = id
            saveConversationId(id)
          }
        }
      },
      onError: (err) => {
        connectionError.value = err
        retrying.value = null
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
        controller = null
        void recoverFromModelRejection(err.code)
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

    // Optimistically create the assistant message placeholder
    const assistantMsgId = `assistant-${Date.now()}`
    generation.value = {
      conversationId: targetConversationId ?? '',
      assistantMessageId: assistantMsgId,
      status: 'streaming',
      content: '',
    }
    generationState.value = 'streaming'

    // Add user message to transcript immediately
    transcript.value.push({
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
      status: 'completed',
    })

    return Promise.resolve()
  }

  // ── Abort ────────────────────────────────────────────────────────
  function abort(): void {
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
    else localStorage.removeItem(CONVERSATION_KEY)
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

async function setModel(id: string | null): Promise<void> {
    // Guard programmatic calls; the picker is already disabled in the UI
    // but this prevents a stray setModel during streaming from mutating
    // state mid-turn.
    if (generationState.value === 'streaming') return
    selectedModelId.value = id
    if (id) saveModelId(id)
    else {
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
          message: streamErrorMessage(apiErr.code ?? 'set_model_failed', apiErr.message),
        }
        await recoverFromModelRejection(apiErr.code)
      }
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────
  onBeforeUnmount(() => {
    stopAutoRetry()
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
    setModel,
    loadConversation,
    resetConversation,
    send,
    abort,
    replaceSnapshot,
    cancel,
    retry,
    reconnect,
  }
}
