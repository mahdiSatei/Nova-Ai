import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStream } from '@/composables/useChatStream'
import { cancelGeneration, retryStream, resumeStream, streamChat } from '@/api/chat'
import { getConversation } from '@/api/conversations'
import { ApiError } from '@/api/http'

vi.mock('@/api/chat', () => ({
  streamChat: vi.fn(),
  resumeStream: vi.fn(() => new AbortController()),
  cancelGeneration: vi.fn(),
  retryStream: vi.fn(() => new AbortController()),
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

  it('inputDisabled is false in terminal states (completed/failed/cancelled)', () => {
    const chat = useChatStream()
    for (const st of ['completed', 'failed', 'cancelled'] as const) {
      chat.generationState.value = st
      expect(chat.inputDisabled.value).toBe(false)
    }
  })

  it('cancel falls back to conversationId when generation has empty conv id', async () => {
    const chat = useChatStream()
    chat.conversationId.value = 'conv-9'
    chat.generation.value = {
      conversationId: '', // optimistic placeholder before start event
      assistantMessageId: 'assistant-123',
      status: 'streaming',
      content: '',
    }

    vi.mocked(cancelGeneration).mockResolvedValue({ messageId: 'm-real', status: 'cancelled' })

    await chat.cancel()

    expect(cancelGeneration).toHaveBeenCalledWith('conv-9')
    expect(chat.generationState.value).toBe('cancelled')
  })

  it('cancel with no conversation id at all aborts locally without HTTP call', async () => {
    const chat = useChatStream()
    chat.generationState.value = 'streaming'
    chat.generation.value = {
      conversationId: '',
      assistantMessageId: 'assistant-123',
      status: 'streaming',
      content: '',
    }

    await chat.cancel()

    expect(cancelGeneration).not.toHaveBeenCalled()
    expect(chat.generationState.value).toBe('cancelled')
  })

  it('resume no_active_stream reconciles with the DB instead of failing', async () => {
    // The server's in-memory stream is gone (finished while the page was
    // refreshing): resume responds with a no_active_stream error event.
    vi.mocked(resumeStream).mockImplementation((_convId, handlers) => {
      queueMicrotask(() =>
        handlers.onError({
          code: 'no_active_stream',
          message: 'No active generation found for this conversation.',
        }),
      )
      return new AbortController()
    })

    // Initial load sees the conversation mid-stream; the reconciliation
    // fetch (after resume fails) sees the finished conversation.
    vi.mocked(getConversation)
      .mockResolvedValueOnce({
        id: 'conv-1',
        modelId: 'model-1',
        title: null,
        pinned: false,
        createdAt: '',
        updatedAt: '',
        messages: [
          { id: 'm1', role: 'user', content: 'hi', createdAt: '', status: 'completed' },
          { id: 'm2', role: 'assistant', content: 'partial', createdAt: '', status: 'streaming' },
        ],
      })
      .mockResolvedValue({
        id: 'conv-1',
        modelId: 'model-1',
        title: null,
        pinned: false,
        createdAt: '',
        updatedAt: '',
        messages: [
          { id: 'm1', role: 'user', content: 'hi', createdAt: '', status: 'completed' },
          { id: 'm2', role: 'assistant', content: 'final answer', createdAt: '', status: 'completed' },
        ],
      })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')
    // Reconciliation is async (fires from the resume onError microtask).
    await vi.waitFor(() => {
      expect(chat.generationState.value).toBe('completed')
    })

    expect(chat.generation.value?.content).toBe('final answer')
    expect(chat.inputDisabled.value).toBe(false)
    expect(chat.connectionError.value).toBeNull()
  })

  it('send adopts real ids from the SSE start event', async () => {
    let startHandler: ((info: { conversationId: string; assistantMessageId: string }) => void) | undefined
    vi.mocked(streamChat).mockImplementation((_body, handlers) => {
      startHandler = handlers.onStart
      return new AbortController()
    })

    const chat = useChatStream()
    chat.selectedModelId.value = 'model-1'
    await chat.send('first message')

    expect(chat.generationState.value).toBe('streaming')
    expect(chat.conversationId.value).toBeNull()

    // Server assigns ids before the first token.
    startHandler?.({ conversationId: 'conv-real', assistantMessageId: 'msg-real' })

    expect(chat.conversationId.value).toBe('conv-real')
    expect(chat.generation.value?.assistantMessageId).toBe('msg-real')
    expect(chat.generation.value?.conversationId).toBe('conv-real')
  })

  it('retry streams from the targeted failed message and adopts the new ids', async () => {
    let startHandler: ((info: { conversationId: string; assistantMessageId: string }) => void) | undefined
    let capturedHandlers: Parameters<typeof retryStream>[2] | undefined
    vi.mocked(retryStream).mockImplementation((_convId, _msgId, handlers) => {
      capturedHandlers = handlers
      startHandler = handlers.onStart
      return new AbortController()
    })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')
    // Transcript now has a failed assistant row; generationState is idle
    // (this is exactly the post-refresh scenario that used to dead-end).
    chat.transcript.value = [
      { id: 'm1', role: 'user', content: 'hi', createdAt: '', status: 'completed' },
      { id: 'm2', role: 'assistant', content: '', createdAt: '', status: 'failed' },
    ]
    chat.generation.value = null
    chat.generationState.value = 'idle'

    await chat.retry('m2')

    expect(retryStream).toHaveBeenCalledWith('conv-1', 'm2', expect.anything())
    expect(chat.generationState.value).toBe('streaming')
    expect(chat.connectionError.value).toBeNull()

    // Server opens the retry stream with real ids.
    startHandler?.({ conversationId: 'conv-1', assistantMessageId: 'm-new' })
    expect(chat.generation.value?.assistantMessageId).toBe('m-new')
    expect(chat.transcript.value.some((m) => m.id === 'm-new' && m.status === 'streaming')).toBe(true)

    // Deltas land on the new row.
    capturedHandlers?.onDelta('hello ', false)
    capturedHandlers?.onDelta('world', false)
    expect(chat.generation.value?.content).toBe('hello world')
    expect(chat.transcript.value.find((m) => m.id === 'm-new')?.content).toBe('hello world')

    capturedHandlers?.onDone()
    expect(chat.generationState.value).toBe('completed')
    expect(chat.inputDisabled.value).toBe(false)
    // The old failed row (m2) was replaced by the new streaming row (m-new).
    expect(chat.transcript.value.find((m) => m.id === 'm2')).toBeUndefined()
  })

  it('retry replaces only the targeted message when multiple failures exist', async () => {
    let startHandler: ((info: { conversationId: string; assistantMessageId: string }) => void) | undefined
    let capturedHandlers: Parameters<typeof retryStream>[2] | undefined
    vi.mocked(retryStream).mockImplementation((_convId, _msgId, handlers) => {
      capturedHandlers = handlers
      startHandler = handlers.onStart
      return new AbortController()
    })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')
    chat.transcript.value = [
      { id: 'm1', role: 'user', content: 'hi', createdAt: '', status: 'completed' },
      { id: 'm2', role: 'assistant', content: '', createdAt: '', status: 'failed' },
      { id: 'm3', role: 'user', content: 'bye', createdAt: '', status: 'completed' },
      { id: 'm4', role: 'assistant', content: '', createdAt: '', status: 'failed' },
    ]
    chat.generation.value = null
    chat.generationState.value = 'idle'

    // Retry only m4 (the second failed message)
    await chat.retry('m4')

    expect(retryStream).toHaveBeenCalledWith('conv-1', 'm4', expect.anything())
    expect(chat.generationState.value).toBe('streaming')

    // Server opens the retry stream with real ids.
    startHandler?.({ conversationId: 'conv-1', assistantMessageId: 'm-new' })

    // Only m4 should be replaced; m2 should remain as a failed row in history.
    expect(chat.transcript.value.find((m) => m.id === 'm2')?.status).toBe('failed')
    expect(chat.transcript.value.find((m) => m.id === 'm4')).toBeUndefined()
    expect(chat.transcript.value.find((m) => m.id === 'm-new')?.status).toBe('streaming')
  })

  it('retry replaces a cancelled message (not just failed)', async () => {
    let startHandler: ((info: { conversationId: string; assistantMessageId: string }) => void) | undefined
    vi.mocked(retryStream).mockImplementation((_convId, _msgId, handlers) => {
      startHandler = handlers.onStart
      return new AbortController()
    })

    const chat = useChatStream()
    await chat.loadConversation('conv-1')
    chat.transcript.value = [
      { id: 'm1', role: 'user', content: 'hi', createdAt: '', status: 'completed' },
      { id: 'm2', role: 'assistant', content: '', createdAt: '', status: 'cancelled' },
    ]
    chat.generation.value = null
    chat.generationState.value = 'idle'

    await chat.retry('m2')

    startHandler?.({ conversationId: 'conv-1', assistantMessageId: 'm-new' })

    // The cancelled row should be replaced by the new streaming row.
    expect(chat.transcript.value.find((m) => m.id === 'm2')).toBeUndefined()
    expect(chat.transcript.value.find((m) => m.id === 'm-new')?.status).toBe('streaming')
  })

  it('retry surfaces an error banner instead of silently doing nothing when no failed row exists', async () => {
    const chat = useChatStream()
    chat.conversationId.value = 'conv-1'
    chat.transcript.value = [
      { id: 'm1', role: 'user', content: 'hi', createdAt: '', status: 'completed' },
    ]

    await chat.retry()

    expect(retryStream).not.toHaveBeenCalled()
    expect(chat.connectionError.value).not.toBeNull()
    expect(chat.generationState.value).toBe('idle')
  })

  it('loadConversation on 404 clears the stale stored id and shows the deleted-conversation banner', async () => {
    localStorage.setItem('mmcb.lastConversationId', 'conv-deleted')
    const apiErr = new ApiError(404, { code: 'conversation_not_found', message: 'Conversation not found.' }, 'nf')
    vi.mocked(getConversation).mockRejectedValue(apiErr)

    const chat = useChatStream()
    await chat.loadConversation('conv-deleted')

    expect(chat.connectionError.value?.code).toBe('conversation_not_found')
    expect(chat.connectionError.value?.message).toContain('وجود ندارد')
    // Stale id must be gone so the stored-id redirect can't loop.
    expect(localStorage.getItem('mmcb.lastConversationId')).toBeNull()
    // State is reset, not stuck on a dead conversation.
    expect(chat.transcript.value).toHaveLength(0)
    expect(chat.generationState.value).toBe('idle')
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
