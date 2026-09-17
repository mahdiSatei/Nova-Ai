import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStream } from '@/composables/useChatStream'
import { cancelGeneration, retryGeneration } from '@/api/chat'
import { getConversation } from '@/api/conversations'

vi.mock('@/api/chat', () => ({
  streamChat: vi.fn(),
  cancelGeneration: vi.fn(),
  retryGeneration: vi.fn(),
}))

vi.mock('@/api/conversations', () => ({
  getConversation: vi.fn(),
  listConversations: vi.fn(),
}))

describe('useChatStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('starts in idle state with connected + idle generation', () => {
    const chat = useChatStream()
    expect(chat.connectionState.value).toBe('connected')
    expect(chat.generationState.value).toBe('idle')
    expect(chat.generation.value).toBeNull()
  })

  it('detects streaming message on load (FR-9)', async () => {
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1',
      modelId: 'model-1',
      title: null,
      pinned: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: [
        { id: 'm1', role: 'user', content: 'hello', createdAt: '2024-01-01T00:00:00Z', status: 'completed' },
        { id: 'm2', role: 'assistant', content: 'partial reply', createdAt: '2024-01-01T00:00:01Z', status: 'streaming' },
      ],
    })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')

    expect(chat.transcript.value).toHaveLength(2)
    expect(chat.generationState.value).toBe('streaming')
    expect(chat.generation.value?.assistantMessageId).toBe('m2')
    expect(chat.generation.value?.content).toBe('partial reply')
    expect(chat.generation.value?.status).toBe('streaming')
  })

  it('leaves generation idle when all messages completed', async () => {
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1',
      modelId: 'model-1',
      title: null,
      pinned: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', createdAt: '2024-01-01T00:00:00Z', status: 'completed' },
        { id: 'm2', role: 'assistant', content: 'full reply', createdAt: '2024-01-01T00:00:01Z', status: 'completed' },
      ],
    })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')

    expect(chat.generationState.value).toBe('idle')
    expect(chat.generation.value).toBeNull()
  })

  it('replaceSnapshot overwrites content without duplication (FR-7)', async () => {
    const chat = useChatStream()
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm1',
      status: 'streaming',
      content: 'local partial text',
    }

    chat.replaceSnapshot('server full response')

    expect(chat.generation.value?.content).toBe('server full response')
    expect(chat.generation.value?.content).not.toContain('local partial text')
  })

  it('cancel calls cancelGeneration endpoint (FR-10)', async () => {
    const chat = useChatStream()
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm-stream',
      status: 'streaming',
      content: 'partial',
    }

    vi.mocked(cancelGeneration).mockResolvedValue({ messageId: 'm-stream', status: 'cancelled' })

    await chat.cancel()

    expect(cancelGeneration).toHaveBeenCalledWith('conv-1')
    expect(chat.generationState.value).toBe('cancelled')
    expect(chat.generation.value?.content).toBe('partial') // preserved
  })

  it('cancel handles no_active_generation by reloading conversation', async () => {
    const chat = useChatStream()
    chat.conversationId.value = 'conv-1'
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm-stream',
      status: 'streaming',
      content: 'partial',
    }

    const apiErr = new Error('no active gen') as any
    apiErr.code = 'no_active_generation'
    apiErr.status = 409
    vi.mocked(cancelGeneration).mockRejectedValue(apiErr)
    vi.mocked(getConversation).mockResolvedValue({
      id: 'conv-1',
      modelId: 'm1',
      title: null,
      pinned: false,
      createdAt: '',
      updatedAt: '',
      messages: [],
    })

    await chat.cancel()

    expect(getConversation).toHaveBeenCalledWith('conv-1')
  })

  it('inputDisabled is true during streaming, false when idle (FR-3)', async () => {
    const chat = useChatStream()
    expect(chat.inputDisabled.value).toBe(false)

    chat.generationState.value = 'streaming'
    expect(chat.inputDisabled.value).toBe(true)

    chat.generationState.value = 'idle'
    expect(chat.inputDisabled.value).toBe(false)
  })

  it('resetConversation clears all state', () => {
    const chat = useChatStream()
    chat.transcript.value = [{ id: 'm1', role: 'user', content: 'hi', createdAt: '', status: 'completed' }]
    chat.generation.value = {
      conversationId: 'conv-1',
      assistantMessageId: 'm2',
      status: 'streaming',
      content: 'text',
    }
    chat.connectionState.value = 'disconnected'
    chat.conversationId.value = 'conv-1'

    chat.resetConversation()

    expect(chat.transcript.value).toHaveLength(0)
    expect(chat.generation.value).toBeNull()
    expect(chat.connectionState.value).toBe('connected')
    expect(chat.conversationId.value).toBeNull()
  })
})
