// Composable مرکزی چت: state machine برای streaming + transcript + abort.
// طبق FR-011..FR-014، AC-009..AC-013. نگه‌داری انتخاب مدل در sessionStorage
// (طبق تصمیم کاربر، صرفاً در همین جلسه مرورگر).
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
    /* sessionStorage ممکن است در حالت private در دسترس نباشد — نادیده بگیر */
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
  /** زمان پایان موفق stream (برای timestamp در حالت optimistic). */
  streamCompletedAt: import('vue').Ref<string | null>
  isStreaming: import('vue').ComputedRef<boolean>
  setModel: (id: string | null) => void
  loadConversation: (id: string) => Promise<void>
  resetConversation: () => void
  send: (text: string) => Promise<void>
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

  async function refreshTranscript(): Promise<void> {
    const id = conversationId.value
    if (!id) return
    try {
      const detail = await getConversation(id)
      transcript.value = detail.messages
    } catch {
      /* ignore — the user will see whatever is already there */
    }
  }

  async function findLatestConversationId(): Promise<string | null> {
    try {
      const page = await listConversations({ limit: 1 })
      return page.items[0]?.id ?? null
    } catch {
      return null
    }
  }

  function send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || phase.value === 'streaming') return Promise.resolve()

    streamingText.value = ''
    streamError.value = null
    streamCompletedAt.value = null
    pendingUser.value = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    }
    phase.value = 'streaming'

    const handlers: StreamHandlers = {
      onDelta: appendDelta,
      onStarted: (id) => {
        conversationId.value = id
      },
      onDone: async () => {
        // stream تمام شد → timestamp ثبت می‌شود تا در حالت optimistic، bubble
        // بتواند timestamp نشان دهد (به‌جای «در حال تولید پاسخ…»).
        streamCompletedAt.value = new Date().toISOString()
        phase.value = 'success'
        if (!conversationId.value) {
          const id = await findLatestConversationId()
          if (id) conversationId.value = id
        }
        const id = conversationId.value
        if (!id) return
        const lengthBefore = transcript.value.length
        await refreshTranscript()
        if (transcript.value.length > lengthBefore) {
          pendingUser.value = null
          streamingText.value = ''
          streamCompletedAt.value = null
        }
      },
      onError: (err) => {
        streamError.value = err
        // stream تمام شد (با خطا) → «در حال تولید» باید برود.
        streamCompletedAt.value = new Date().toISOString()
        phase.value = 'error'
      },
    }

    controller = streamChat(
      {
        conversationId: conversationId.value,
        modelId: selectedModelId.value,
        message: trimmed,
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
      pendingUser.value = null
      streamingText.value = ''
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
