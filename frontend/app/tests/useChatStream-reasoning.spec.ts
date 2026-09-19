import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStream } from '@/composables/useChatStream'
import { streamChat, type StreamHandlers } from '@/api/chat'

vi.mock('@/api/chat', () => ({
  streamChat: vi.fn(),
  resumeStream: vi.fn(() => new AbortController()),
  retryStream: vi.fn(() => new AbortController()),
  cancelGeneration: vi.fn(),
}))

vi.mock('@/api/conversations', () => ({
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  setConversationModel: vi.fn(),
}))

describe('useChatStream reasoning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('is off by default, is only offered for capable models, and persists the choice', () => {
    const chat = useChatStream()
    expect(chat.reasoningEnabled.value).toBe(false)
    expect(chat.reasoningSupported.value).toBe(false)

    chat.setReasoningSupport(true)
    chat.setReasoning(true)

    expect(chat.reasoningEnabled.value).toBe(true)
    expect(sessionStorage.getItem('mmcb.reasoningEnabled')).toBe('true')
  })

  it('drops the preference when the selected model cannot reason', () => {
    const chat = useChatStream()
    chat.setReasoningSupport(true)
    chat.setReasoning(true)

    chat.setReasoningSupport(false)

    expect(chat.reasoningEnabled.value).toBe(false)
    expect(sessionStorage.getItem('mmcb.reasoningEnabled')).toBe('false')
  })

  it('sends the flag and tracks reasoning state from backend events only', async () => {
    // Handlers are captured and driven explicitly: on the wire they arrive
    // after send() has created the optimistic generation, never during it.
    let handlers: StreamHandlers | undefined
    vi.mocked(streamChat).mockImplementation((_body, h) => {
      handlers = h
      return new AbortController()
    })

    const chat = useChatStream()
    chat.selectedModelId.value = 'm1'
    chat.setReasoningSupport(true)
    chat.setReasoning(true)

    expect(chat.reasoningActive.value).toBe(false)
    await chat.send('think about it')

    expect(vi.mocked(streamChat).mock.calls[0][0]).toMatchObject({ message: 'think about it', reasoning: true })

    handlers?.onStart?.({ conversationId: 'c1', assistantMessageId: 'a1' })
    handlers?.onStatus?.({ phase: 'reasoning_started' })
    expect(chat.reasoningActive.value).toBe(true)

    handlers?.onReasoningDelta?.('weighing ', false)
    handlers?.onReasoningDelta?.('options', false)
    handlers?.onStatus?.({ phase: 'reasoning_completed' })
    handlers?.onStatus?.({ phase: 'answer_started' })
    handlers?.onDelta('Answer', false)
    handlers?.onDone()

    expect(chat.reasoningSummary.value).toBe('weighing options')
    expect(chat.reasoningAvailable.value).toBe(true)
    expect(chat.reasoningActive.value).toBe(false)
    expect(chat.reasoningCompleted.value).toBe(true)
    expect(chat.generation.value?.content).toBe('Answer')
  })

  it('shows no reasoning state when the backend sends no reasoning events', async () => {
    vi.mocked(streamChat).mockImplementation((_body, handlers) => {
      handlers.onStart?.({ conversationId: 'c1', assistantMessageId: 'a1' })
      handlers.onDelta('Answer', false)
      handlers.onDone()
      return new AbortController()
    })

    const chat = useChatStream()
    chat.selectedModelId.value = 'm1'
    chat.setReasoningSupport(true)
    chat.setReasoning(true)
    await chat.send('hello')

    expect(chat.reasoningActive.value).toBe(false)
    expect(chat.reasoningCompleted.value).toBe(false)
    expect(chat.reasoningSummary.value).toBe('')
    expect(chat.reasoningAvailable.value).toBe(false)
  })

  it('never sends the flag for a model that does not support reasoning', async () => {
    vi.mocked(streamChat).mockImplementation((_body, handlers) => {
      handlers.onDone()
      return new AbortController()
    })

    const chat = useChatStream()
    chat.selectedModelId.value = 'm1'
    chat.setReasoningSupport(false)
    chat.setReasoning(true) // no-op: not supported
    await chat.send('hello')

    expect(vi.mocked(streamChat).mock.calls[0][0].reasoning).toBe(false)
  })

  it('resets reasoning state for a new generation', async () => {
    const pending: StreamHandlers[] = []
    vi.mocked(streamChat).mockImplementation((_body, handlers) => {
      pending.push(handlers)
      handlers.onStatus?.({ phase: 'reasoning_started' })
      handlers.onReasoningDelta?.(pending.length === 1 ? 'first pass' : 'second pass', false)
      return new AbortController()
    })

    const chat = useChatStream()
    chat.selectedModelId.value = 'm1'
    chat.setReasoningSupport(true)
    chat.setReasoning(true)

    await chat.send('first')
    expect(chat.reasoningActive.value).toBe(true)
    expect(chat.reasoningSummary.value).toBe('first pass')

    // The first turn completes, freeing the concurrency guard for the next one.
    pending[0].onDone()

    await chat.send('second')
    expect(chat.reasoningActive.value).toBe(true)
    expect(chat.reasoningSummary.value).toBe('second pass')
  })
})
