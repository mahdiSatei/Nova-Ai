import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cancelGeneration, retryStream } from '@/api/chat'

// Mock the request function from http module for cancel/retry tests
const mockRequest = vi.fn()

vi.mock('@/api/http', () => ({
  request: (...args: any[]) => mockRequest(...args),
  API_BASE: '',
  buildUrl: (path: string) => path,
  newRequestId: () => 'req-test',
  tokenStore: { load: () => null },
}))

describe('cancelGeneration', () => {
  beforeEach(() => {
    mockRequest.mockClear()
  })

  it('calls POST /v1/chat/:id/cancel via request', async () => {
    mockRequest.mockResolvedValue({ messageId: 'm1', status: 'cancelled' })

    const result = await cancelGeneration('conv-1')

    expect(mockRequest).toHaveBeenCalledWith('/v1/chat/conv-1/cancel', {
      method: 'POST',
    })
    expect(result).toEqual({ messageId: 'm1', status: 'cancelled' })
  })
})

describe('retryStream', () => {
  const sseResponse = (chunks: string[]) =>
    ({
      ok: true,
      body: {
        getReader: () => {
          let i = 0
          return {
            read: async () => (i < chunks.length ? { value: new TextEncoder().encode(chunks[i++]), done: false } : { value: undefined, done: true }),
          }
        },
      },
    }) as unknown as Response

  beforeEach(() => {
    mockRequest.mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        expect(init?.method).toBe('POST')
        expect(String(init?.body)).toBe(JSON.stringify({ failedMessageId: 'm-failed' }))
        return sseResponse([
          'event: start\ndata: {"conversationId":"conv-1","assistantMessageId":"m-new"}\n\n',
          'data: {"delta":"retry"}\n\ndata: {"delta":" answer"}\n\n',
          'event: done\ndata: {}\n\n',
        ])
      }),
    )
  })

  it('POSTs the failedMessageId and routes start/delta/done to handlers', async () => {
    const events: string[] = []
    retryStream('conv-1', 'm-failed', {
      onStart: (info) => events.push(`start:${info.conversationId}:${info.assistantMessageId}`),
      onDelta: (text) => events.push(`delta:${text}`),
      onDone: () => events.push('done'),
      onError: () => events.push('error'),
    })

    await vi.waitFor(() => {
      expect(events.join('|')).toBe('start:conv-1:m-new|delta:retry|delta: answer|done')
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('routes an HTTP error response to onError with the server code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({ ok: false, json: async () => ({ code: 'message_not_retryable', message: 'nope' }) }) as unknown as Response,
      ),
    )
    const errors: { code: string; message: string }[] = []
    retryStream('conv-1', 'm-failed', {
      onDelta: () => {},
      onDone: () => {},
      onError: (err) => errors.push(err),
    })

    await vi.waitFor(() => {
      // Known codes are localized by streamErrorMessage.
      expect(errors).toEqual([
        { code: 'message_not_retryable', message: 'فقط پاسخ‌های ناموفق یا لغوشده قابل تلاش مجدد هستند.' },
      ])
    })
  })
})

describe('SSE event parsing', () => {
  // Test the SSE parsing logic extracted from streamChat
  function parseSseEvent(raw: string): { eventName: string; payload: string } | null {
    let eventName = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    const payload = dataLines.join('\n')
    if (!payload && eventName === 'message') return null
    return { eventName, payload }
  }

  it('parses delta events (data-only)', () => {
    const result = parseSseEvent('data: {"delta":"hello"}\n')
    expect(result).toEqual({ eventName: 'message', payload: '{"delta":"hello"}' })
  })

  it('parses done events', () => {
    const result = parseSseEvent('event: done\n\n')
    expect(result).toEqual({ eventName: 'done', payload: '' })
  })

  it('parses error events with code and message', () => {
    const result = parseSseEvent('event: error\ndata: {"code":"provider_error","message":"down"}\n')
    expect(result).toEqual({
      eventName: 'error',
      payload: '{"code":"provider_error","message":"down"}',
    })
  })

  it('parses error event with JSON.parse', () => {
    const result = parseSseEvent('event: error\ndata: {"code":"provider_error","message":"provider down"}\n')
    expect(result?.eventName).toBe('error')
    if (result?.payload) {
      const parsed = JSON.parse(result.payload)
      expect(parsed.code).toBe('provider_error')
    }
  })

  it('parses events with trailing whitespace (trimStart keeps trailing)', () => {
    const result = parseSseEvent('data: {"delta":"world"}  \n')
    expect(result?.payload).toBe('{"delta":"world"}  ')
  })

  it('handles empty data gracefully', () => {
    const result = parseSseEvent('\n')
    expect(result).toBeNull()
  })

  it('handles event with multi-line data', () => {
    const result = parseSseEvent('event: error\ndata: line1\ndata: line2\n')
    expect(result?.eventName).toBe('error')
    expect(result?.payload).toBe('line1\nline2')
  })

  it('extracts error code from parsed payload', () => {
    const result = parseSseEvent('event: error\ndata: {"code":"provider_error","message":"down"}\n')
    const payload = result?.payload ?? ''
    let parsed: any = {}
    try { parsed = JSON.parse(payload) } catch { /* ignore */ }
    const code = parsed.code ?? 'stream_error'
    expect(code).toBe('provider_error')
  })
})
