// Composable مرکزی چت: dual state model — connection + generation.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { streamChat, type StreamHandlers } from '@/api/chat'
import { cancelGeneration, retryGeneration } from '@/api/chat'
import { getConversation, listConversations } from '@/api/conversations'
import { ApiError } from '@/api/http'
import { streamErrorMessage } from '@/utils/errors'
import type { MessagePublic } from '@/types/api'

const SESSION_KEY = 'mmcb.lastModelId'

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

  // ── Computed ─────────────────────────────────────────────────────
  const inputDisabled = computed(
    () => generationState.value === 'streaming' || generationState.value === 'completed',
  )

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
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
  }

  // ── Snapshot replacement (FR-7) ──────────────────────────────────
  function replaceSnapshot(snapshot: string): void {
    if (generation.value) {
      generation.value = { ...generation.value, content: snapshot }
    }
  }

  // ── Cancel (FR-10) ───────────────────────────────────────────────
  async function cancel(): Promise<void> {
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
        await resumeStream(detail.id, streamingMsg.id, streamingMsg.content)
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
  async function resumeStream(
    convId: string,
    assistantMsgId: string,
    existingContent: string,
  ): Promise<void> {
    const modelId = selectedModelId.value
    if (!modelId) return

    const lastUserMsg = transcript.value.filter((m) => m.role === 'user').at(-1)
    if (!lastUserMsg) return

    controller = streamChat(
      {
        conversationId: convId,
        modelId,
        message: lastUserMsg.content,
      },
      {
        onDelta: (text: string) => {
          if (generation.value) {
            generation.value = { ...generation.value, content: generation.value.content + text }
          }
        },
        onDone: () => {
          if (generation.value) {
            generation.value = { ...generation.value, status: 'completed' }
          }
          generationState.value = 'completed'
          controller = null
        },
        onError: (err) => {
          connectionError.value = err
          if (generation.value) {
            generation.value = { ...generation.value, status: 'failed' }
          }
          generationState.value = 'failed'
          controller = null
        },
      },
    )
  }

  // ── Load conversation (FR-1, FR-9) ───────────────────────────────
  async function loadConversation(id: string): Promise<void> {
    connectionError.value = null
    setConnected()
    try {
      const detail = await getConversation(id)
      transcript.value = detail.messages
      conversationId.value = detail.id
      currentStreamConversationId = detail.id

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
      } else {
        generation.value = null
        generationState.value = 'idle'
      }
    } catch (err) {
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

    const handlers: StreamHandlers = {
      onDelta: (delta: string) => {
        if (generation.value) {
          generation.value = { ...generation.value, content: generation.value.content + delta }
        }
      },
      onDone: async () => {
        if (generation.value) {
          generation.value = { ...generation.value, status: 'completed' }
        }
        generationState.value = 'completed'
        controller = null

        if (!conversationId.value) {
          const id = await findLatestConversationId()
          if (id) conversationId.value = id
        }
      },
      onError: (err) => {
        connectionError.value = err
        if (generation.value) {
          generation.value = { ...generation.value, status: 'failed' }
        }
        generationState.value = 'failed'
        controller = null
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
    abort()
  })

  return {
    connectionState,
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
  }
}
