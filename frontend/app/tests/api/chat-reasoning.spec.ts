import { describe, it, expect, vi, beforeEach } from 'vitest'
import { streamChat } from '@/api/chat'

vi.mock('@/api/http', () => ({
  API_BASE: '',
  buildUrl: (path: string) => path,
  newRequestId: () => 'req-test',
  tokenStore: { load: () => null },
  withStreamAuthRetry: async (fetchFn: (token: string | null) => Promise<Response>) => fetchFn(null),
  request: vi.fn(),
}))

function sse(frames: string[]): Response {
  const body = frames.join('\n\n') + '\n\n'
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let done = false
        return {
          read: async () => {
            if (done) return { value: undefined, done: true }
            done = true
            return { value: new TextEncoder().encode(body), done: false }
          },
        }
      },
    },
  } as unknown as Response
}

describe('streamChat reasoning frames', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards reasoning phases, reasoning deltas and answer deltas separately', async () => {
    const phases: string[] = []
    const reasoning: string[] = []
    const answer: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'event: status\ndata: {"phase":"reasoning_started"}',
          'event: reasoning_delta\ndata: {"delta":"weighing "}',
          'event: reasoning_delta\ndata: {"delta":"options"}',
          'event: status\ndata: {"phase":"reasoning_completed"}',
          'event: status\ndata: {"phase":"answer_started"}',
          'data: {"delta":"The answer."}',
          'event: done\ndata: {}',
        ]),
      ),
    )

    await new Promise<void>((resolve) => {
      streamChat(
        { message: 'x', modelId: 'm', reasoning: true },
        {
          onDelta: (delta) => answer.push(delta),
          onDone: () => resolve(),
          onError: () => resolve(),
          onStatus: (info) => phases.push(info.phase),
          onReasoningDelta: (delta) => reasoning.push(delta),
        },
      )
    })

    expect(phases).toEqual(['reasoning_started', 'reasoning_completed', 'answer_started'])
    expect(reasoning.join('')).toBe('weighing options')
    expect(answer).toEqual(['The answer.'])
  })

  it('ignores malformed reasoning frames and keeps the stream alive', async () => {
    const reasoning: string[] = []
    let done = false

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'event: reasoning_delta\ndata: {not json}',
          'event: reasoning_delta\ndata: {"delta":"ok"}',
          'event: done\ndata: {}',
        ]),
      ),
    )

    await new Promise<void>((resolve) => {
      streamChat(
        { message: 'x', modelId: 'm', reasoning: true },
        {
          onDelta: () => {},
          onDone: () => {
            done = true
            resolve()
          },
          onError: () => resolve(),
          onReasoningDelta: (delta) => reasoning.push(delta),
        },
      )
    })

    expect(reasoning).toEqual(['ok'])
    expect(done).toBe(true)
  })

  it('treats a live reasoning delta as an append (isFirst = false)', async () => {
    const calls: Array<[string, boolean]> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse(['event: reasoning_delta\ndata: {"delta":"accumulated"}', 'event: done\ndata: {}'])),
    )

    await new Promise<void>((resolve) => {
      streamChat(
        { message: 'x', modelId: 'm', reasoning: true },
        {
          onDelta: () => {},
          onDone: () => resolve(),
          onError: () => resolve(),
          onReasoningDelta: (delta, isFirst) => calls.push([delta, isFirst]),
        },
      )
    })

    expect(calls).toEqual([['accumulated', false]])
  })
})
