// Composable مرکزی چت: state machine برای streaming + transcript + abort.
import { computed, onBeforeUnmount, ref } from 'vue'
import { streamChat, type StreamHandlers } from '@/api/chat'
import { getConversation, listConversations } from '@/api/conversations'
import { ApiError } from '@/api/http'
import type { MessagePublic } from '@/types/api'

const SESSION_KEY = 'mmcb.lastModelId'

type Phase = 'idle' | 'loading' | 'streaming' | 'error' | 'success'

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
  phase: import('vue').Ref<Phase>
  transcript: import('vue').Ref<MessagePublic[]>
  streamingText: import('vue').Ref<string>
  pendingUser: import('vue').Ref<MessagePublic | null>
  streamError: import('vue').Ref<{ code: string; message: string } | null>
  conversationId: import('vue').Ref<string | null>
  selectedModelId: import('vue').Ref<string | null>
  streamCompletedAt: import('vue').Ref<string | null>
  isStreaming: import('vue').ComputedRef<boolean>
  setModel: (id: string | null) => void
  loadConversation: (id: string) => Promise<void>
  resetConversation: () => void
  send: (text: string, opts?: { fileId?: string | null }) => Promise<void>
  abort: () => void
}

export function useChatStream(): ChatStreamHandle {
  const phase = ref<Phase>('idle')
  const transcript = ref<MessagePublic[]>([])
  const streamingText = ref('')
  const pendingUser = ref<MessagePublic | null>(null)
  const streamError = ref<{ code: string; message: string } | null>(null)
  const conversationId = ref<string | null>(null)
  const selectedModelId = ref<string | null>(loadSavedModelId())
  const streamCompletedAt = ref<string | null>(null)

  let controller: AbortController | null = null

  const isStreaming = computed(() => phase.value === 'streaming')

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

  function resetConversation(): void {
    abort()
    transcript.value = []
    conversationId.value = null
    pendingUser.value = null
    streamingText.value = ''
    streamError.value = null
    streamCompletedAt.value = null
    phase.value = 'idle'
  }

  async function loadConversation(id: string): Promise<void> {
    phase.value = 'loading'
    streamError.value = null
    try {
      const detail = await getConversation(id)
      transcript.value = detail.messages
      conversationId.value = detail.id
      phase.value = 'idle'
    } catch (err) {
      streamError.value =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: 'network_error', message: 'خطا در بارگذاری گفتگو.' }
      phase.value = 'error'
    }
  }

  function appendDelta(text: string): void {
    streamingText.value += text
  }

  async function findLatestConversationId(): Promise<string | null> {
    try {
      const page = await listConversations({ limit: 1 })
      return page.items[0]?.id ?? null
    } catch {
      return null
    }
  }

  function send(text: string, opts?: { fileId?: string | null }): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || phase.value === 'streaming') return Promise.resolve()
    const fileId = opts?.fileId?.trim() || null

    // ۱. پیام کاربر را در همان لحظه در pendingUser می‌گذاریم
    const userMsg: MessagePublic = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    }
    pendingUser.value = userMsg

    streamingText.value = ''
    streamError.value = null
    streamCompletedAt.value = null
    phase.value = 'streaming'

    const handlers: StreamHandlers = {
      onDelta: appendDelta,
      onStarted: (id) => {
        conversationId.value = id
      },
      onDone: async () => {
        streamCompletedAt.value = new Date().toISOString()
        phase.value = 'idle' // آماده برای دریافت پیام بعدی

        // ۲. انتقال پیام کاربر از pendingUser به داخل transcript اصلی
        if (pendingUser.value) {
          transcript.value.push(pendingUser.value)
          pendingUser.value = null
        }

        // ۳. انتقال متن تولید شده توسط هوش مصنوعی به داخل transcript اصلی
        if (streamingText.value) {
          transcript.value.push({
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: streamingText.value,
            createdAt: new Date().toISOString(),
          })
          streamingText.value = ''
        }

        streamCompletedAt.value = null

        // دریافت آی‌دی چت در صورت نیاز
        if (!conversationId.value) {
          const id = await findLatestConversationId()
          if (id) conversationId.value = id
        }
      },
      onError: (err) => {
        streamError.value = err
        streamCompletedAt.value = new Date().toISOString()
        phase.value = 'error'

        // در صورت بروز خطا هم پیام‌ها را نگه دار تا چت خالی نشود
        if (pendingUser.value) {
          transcript.value.push(pendingUser.value)
          pendingUser.value = null
        }
        if (streamingText.value) {
          transcript.value.push({
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: streamingText.value,
            createdAt: new Date().toISOString(),
          })
          streamingText.value = ''
        }
      },
    }

    controller = streamChat(
      {
        conversationId: conversationId.value,
        modelId: selectedModelId.value,
        message: trimmed,
        fileId,
      },
      handlers,
    )

    return Promise.resolve()
  }

  function abort(): void {
    if (controller) {
      controller.abort()
      controller = null
    }
    if (phase.value === 'streaming') {
      if (pendingUser.value) {
        transcript.value.push(pendingUser.value)
        pendingUser.value = null
      }
      if (streamingText.value) {
        transcript.value.push({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: streamingText.value,
          createdAt: new Date().toISOString(),
        })
        streamingText.value = ''
      }
      phase.value = 'idle'
    }
  }

  onBeforeUnmount(() => {
    abort()
  })

  return {
    phase,
    transcript,
    streamingText,
    pendingUser,
    streamError,
    conversationId,
    selectedModelId,
    streamCompletedAt,
    isStreaming,
    setModel,
    loadConversation,
    resetConversation,
    send,
    abort,
  }
}