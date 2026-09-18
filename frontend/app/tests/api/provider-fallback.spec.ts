import { describe, expect, it, vi, beforeEach } from 'vitest'
import { streamErrorMessage } from '@/utils/errors'

const encoder = new TextEncoder()

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('provider fallback stream handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('translates the all_providers_unavailable code for the user', () => {
    const message = streamErrorMessage('all_providers_unavailable')
    expect(message).toContain('در دسترس')
    expect(message).not.toMatch(/provider|openai|groq|sk-/i)
  })

  it('translates transient provider codes', () => {
    expect(streamErrorMessage('provider_timeout')).toContain('طول کشید')
    expect(streamErrorMessage('provider_rate_limited')).toContain('شلوغ')
  })

  it('reports a retrying status event without treating it as a delta', async () => {
    const { streamChat } = await import('@/api/chat')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        'event: status\ndata: {"phase":"retrying","attempt":2,"maxAttempts":2}\n\n',
        'data: {"delta":"سلام"}\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    )

    const deltas: string[] = []
    const statuses: unknown[] = []
    let done = false

    await new Promise<void>((resolve) => {
      streamChat(
        { message: 'hi', modelId: 'm1' },
        {
          onDelta: (text: string) => deltas.push(text),
          onDone: () => {
            done = true
            resolve()
          },
          onError: () => resolve(),
          onStatus: (info) => statuses.push(info),
        },
      )
    })

    expect(statuses).toEqual([{ phase: 'retrying', attempt: 2, maxAttempts: 2 }])
    expect(deltas).toEqual(['سلام'])
    expect(done).toBe(true)
  })

  it('surfaces all_providers_unavailable as a localized error', async () => {
    const { streamChat } = await import('@/api/chat')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        'event: error\ndata: {"code":"all_providers_unavailable","message":"raw upstream detail"}\n\n',
      ]),
    )

    const errors: Array<{ code: string; message: string }> = []
    await new Promise<void>((resolve) => {
      streamChat(
        { message: 'hi', modelId: 'm1' },
        {
          onDelta: () => {},
          onDone: () => resolve(),
          onError: (err) => {
            errors.push(err)
            resolve()
          },
        },
      )
    })

    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe('all_providers_unavailable')
    // The localized Persian message replaces the raw server message.
    expect(errors[0].message).not.toBe('raw upstream detail')
  })
})
