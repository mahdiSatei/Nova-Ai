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

describe('streamChat web search frames', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards search lifecycle phases and citations', async () => {
    const phases: string[] = []
    let citations: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'event: status\ndata: {"phase":"search_started","query":"cats"}',
          'event: status\ndata: {"phase":"search_completed","query":"cats","sources":2,"credits":2}',
          'data: {"delta":"answer [S1]"}',
          'event: citations\ndata: {"sources":[{"id":"S1","title":"T","url":"https://a","snippet":"s"}]}',
          'event: done\ndata: {}',
        ]),
      ),
    )

    await new Promise<void>((resolve) => {
      streamChat(
        { message: 'x', modelId: 'm', webSearch: true },
        {
          onDelta: () => {},
          onDone: () => resolve(),
          onError: () => resolve(),
          onStatus: (info) => phases.push(info.phase),
          onCitations: (s) => {
            citations = s
          },
        },
      )
    })

    expect(phases).toEqual(['search_started', 'search_completed'])
    expect(citations).toEqual([{ id: 'S1', title: 'T', url: 'https://a', snippet: 's' }])
  })
})
