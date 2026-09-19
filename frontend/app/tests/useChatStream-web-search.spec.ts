import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStream } from '@/composables/useChatStream'
import { streamChat } from '@/api/chat'

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

describe('useChatStream web search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('is disabled by default and persists the toggle', () => {
    const chat = useChatStream()
    expect(chat.webSearchEnabled.value).toBe(false)
    chat.setWebSearch(true)
    expect(chat.webSearchEnabled.value).toBe(true)
    expect(sessionStorage.getItem('mmcb.webSearchEnabled')).toBe('true')
  })

  it('sends the flag with the chat request and exposes activity + citations', async () => {
    vi.mocked(streamChat).mockImplementation((_body, handlers) => {
      handlers.onStart?.({ conversationId: 'c1', assistantMessageId: 'a1' })
      handlers.onStatus?.({ phase: 'search_started', query: 'cats' })
      handlers.onStatus?.({ phase: 'search_completed', query: 'cats', sources: 1, credits: 2 })
      handlers.onCitations?.([{ id: 'S1', title: 'T', url: 'https://a', snippet: 's' }])
      handlers.onDone()
      return new AbortController()
    })

    const chat = useChatStream()
    chat.selectedModelId.value = 'm1'
    chat.setWebSearch(true)
    await chat.send('tell me')

    expect(vi.mocked(streamChat).mock.calls[0][0]).toMatchObject({ message: 'tell me', webSearch: true })
    expect(chat.citations.value).toEqual([{ id: 'S1', title: 'T', url: 'https://a', snippet: 's' }])
  })
})
