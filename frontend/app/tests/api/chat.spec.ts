import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cancelGeneration, retryGeneration } from '@/api/chat'

// Mock the request function from http module for cancel/retry tests
const mockRequest = vi.fn()

vi.mock('@/api/http', () => ({
  request: (...args: any[]) => mockRequest(...args),
  API_BASE: '',
  buildUrl: (path: string) => path,
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

describe('retryGeneration', () => {
  beforeEach(() => {
    mockRequest.mockClear()
  })

  it('calls POST /v1/chat/:id/retry with failedMessageId in body', async () => {
    mockRequest.mockResolvedValue({ messageId: 'm-new', status: 'streaming' })

    const result = await retryGeneration('conv-1', 'm-failed')

    expect(mockRequest).toHaveBeenCalledWith('/v1/chat/conv-1/retry', {
      method: 'POST',
      body: { failedMessageId: 'm-failed' },
    })
    expect(result).toEqual({ messageId: 'm-new', status: 'streaming' })
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
