import { API_BASE, buildUrl, newRequestId, request, withStreamAuthRetry } from '@/api/http'
import { streamErrorMessage } from '@/utils/errors'
import type { ChatRequest, CitationSource, SseCitations, SseDelta, SseError, SseStatus } from '@/types/api'

export interface StreamStartInfo {
  conversationId: string
  assistantMessageId: string
}

export interface StreamHandlers {
  /** text is the delta; isFirst is true only for the first event (accumulated text on resume) */
  onDelta: (text: string, isFirst: boolean) => void
  onDone: () => void
  /** Stream-level error event, HTTP-level error, or network failure */
  onError: (err: { code: string; message: string }) => void
  /** Backend status change: retry/failover (phase 6) or web-search lifecycle (phase 7). */
  onStatus?: (info: SseStatus) => void
  /** Web-search sources cited by the final answer (phase 7). */
  onCitations?: (sources: CitationSource[]) => void
  /** Server assigns the real conversation + assistant message ids (new streams) */
  onStart?: (info: StreamStartInfo) => void
}

/**
 * POST /v1/chat/stream — text/event-stream.
 * Parses `data: {"delta":"..."}` events until `event: done` or `event: error`.
 * Aborts cleanly when the returned controller is aborted (FR-014).
 */
export function streamChat(body: ChatRequest, handlers: StreamHandlers): AbortController {
  const controller = new AbortController()

  void (async () => {
    try {
      const res = await withStreamAuthRetry(async (accessToken) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-Request-ID': newRequestId(),
        }
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`
        return fetch(buildUrl('/v1/chat/stream'), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      })
      if (!res) return

      if (!res.ok) {
        let code = 'unknown_error'
        let serverMessage = `Request failed with status ${res.status}`
        try {
          const errBody = await res.json()
          code = errBody.code ?? code
          serverMessage = errBody.message ?? serverMessage
        } catch {
          /* non-JSON error body */
        }
        handlers.onError({ code, message: streamErrorMessage(code, serverMessage) })
        return
      }
      if (!res.body) {
        handlers.onError({
          code: 'no_stream',
          message: streamErrorMessage('no_stream'),
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false

      while (!done) {
        const { value, done: eof } = await reader.read()
        if (eof) break
        buffer += decoder.decode(value, { stream: true })

        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)

          let eventName = 'message'
          const dataLines: string[] = []
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
          }
          const payload = dataLines.join('\n')

          if (eventName === 'done') {
            handlers.onDone()
            return
          }
          if (eventName === 'status') {
            // Phase 6/7: non-terminal progress event — retry/failover before
            // the first token, or a web-search lifecycle phase.
            try {
              const parsed = JSON.parse(payload) as SseStatus
              handlers.onStatus?.(parsed)
            } catch {
              /* ignore malformed status frame */
            }
            continue
          }
          if (eventName === 'citations') {
            try {
              const parsed = JSON.parse(payload) as SseCitations
              if (Array.isArray(parsed.sources)) handlers.onCitations?.(parsed.sources)
            } catch {
              /* ignore malformed citations frame */
            }
            continue
          }
          if (eventName === 'error') {
            let parsed: Partial<SseError> = {}
            try {
              parsed = JSON.parse(payload) as SseError
            } catch {
              /* malformed payload */
            }
            const code = parsed.code ?? 'stream_error'
            handlers.onError({
              code,
              message: streamErrorMessage(code, parsed.message),
            })
            return
          }
          if (eventName === 'start') {
            let startInfo: Partial<StreamStartInfo> = {}
            try {
              startInfo = JSON.parse(payload) as Partial<StreamStartInfo>
            } catch {
              /* malformed payload */
            }
            if (startInfo.conversationId && startInfo.assistantMessageId) {
              handlers.onStart?.({
                conversationId: startInfo.conversationId,
                assistantMessageId: startInfo.assistantMessageId,
              })
            }
            continue
          }
          if (payload) {
            try {
              const parsed = JSON.parse(payload) as SseDelta
              if (typeof parsed.delta === 'string') handlers.onDelta(parsed.delta, false)
            } catch {
              /* ignore malformed data frame */
            }
          }
        }
      }
      // Stream closed without an explicit done/error event.
      handlers.onDone()
    } catch (err) {
      if (controller.signal.aborted) return
      const fallback =
        err instanceof Error && err.message ? err.message : undefined
      handlers.onError({
        code: 'network_error',
        message: streamErrorMessage('network_error', fallback),
      })
    }
  })()

  return controller
}

/**
 * POST /v1/chat/:conversationId/cancel — cancel the active generation.
 */
export async function cancelGeneration(conversationId: string): Promise<{ messageId: string; status: string }> {
  return request<{ messageId: string; status: string }>(`/v1/chat/${conversationId}/cancel`, {
    method: 'POST',
  })
}

/**
 * POST /v1/chat/:conversationId/retry — retry a failed/cancelled
 * generation as a live SSE stream. Same event protocol as streamChat:
 * start (ids), deltas, done/error. Returns an AbortController.
 */
export function retryStream(
  conversationId: string,
  failedMessageId: string,
  handlers: StreamHandlers,
): AbortController {
  const controller = new AbortController()

  void (async () => {
    try {
      const res = await withStreamAuthRetry(async (accessToken) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-Request-ID': newRequestId(),
        }
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`
        return fetch(buildUrl(`/v1/chat/${conversationId}/retry`), {
          method: 'POST',
          headers,
          body: JSON.stringify({ failedMessageId }),
          signal: controller.signal,
        })
      })
      if (!res) return

      if (!res.ok) {
        let code = 'unknown_error'
        let serverMessage = `Request failed with status ${res.status}`
        try {
          const errBody = await res.json()
          code = errBody.code ?? code
          serverMessage = errBody.message ?? serverMessage
        } catch {
          /* non-JSON error body */
        }
        handlers.onError({ code, message: streamErrorMessage(code, serverMessage) })
        return
      }
      if (!res.body) {
        handlers.onError({
          code: 'no_stream',
          message: streamErrorMessage('no_stream'),
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done: eof } = await reader.read()
        if (eof) break
        buffer += decoder.decode(value, { stream: true })

        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)

          let eventName = 'message'
          const dataLines: string[] = []
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
          }
          const payload = dataLines.join('\n')

          if (eventName === 'done') {
            handlers.onDone()
            return
          }
          if (eventName === 'citations') {
            try {
              const parsed = JSON.parse(payload) as SseCitations
              if (Array.isArray(parsed.sources)) handlers.onCitations?.(parsed.sources)
            } catch {
              /* ignore malformed citations frame */
            }
            continue
          }
          if (eventName === 'error') {
            let parsed: Partial<SseError> = {}
            try {
              parsed = JSON.parse(payload) as SseError
            } catch {
              /* malformed payload */
            }
            const code = parsed.code ?? 'stream_error'
            handlers.onError({
              code,
              message: streamErrorMessage(code, parsed.message),
            })
            return
          }
          if (eventName === 'start') {
            let startInfo: Partial<StreamStartInfo> = {}
            try {
              startInfo = JSON.parse(payload) as Partial<StreamStartInfo>
            } catch {
              /* malformed payload */
            }
            if (startInfo.conversationId && startInfo.assistantMessageId) {
              handlers.onStart?.({
                conversationId: startInfo.conversationId,
                assistantMessageId: startInfo.assistantMessageId,
              })
            }
            continue
          }
          if (payload) {
            try {
              const parsed = JSON.parse(payload) as SseDelta
              if (typeof parsed.delta === 'string') handlers.onDelta(parsed.delta, false)
            } catch {
              /* ignore malformed data frame */
            }
          }
        }
      }
      // Stream closed without an explicit done/error event.
      handlers.onDone()
    } catch (err) {
      if (controller.signal.aborted) return
      const fallback =
        err instanceof Error && err.message ? err.message : undefined
      handlers.onError({
        code: 'network_error',
        message: streamErrorMessage('network_error', fallback),
      })
    }
  })()

  return controller
}

/**
 * POST /v1/chat/:conversationId/resume — resume an in-progress stream.
 * Subscribes to the active provider stream held in memory. Receives
 * all accumulated content as a single delta, then live tokens.
 */
export function resumeStream(
  conversationId: string,
  handlers: StreamHandlers,
): AbortController {
  const controller = new AbortController()

  void (async () => {
    try {
      const res = await withStreamAuthRetry(async (accessToken) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-Request-ID': newRequestId(),
        }
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`
        return fetch(buildUrl(`/v1/chat/${conversationId}/resume`), {
          method: 'POST',
          headers,
          signal: controller.signal,
        })
      })
      if (!res) return

      if (!res.ok) {
        let code = 'unknown_error'
        let serverMessage = `Request failed with status ${res.status}`
        try {
          const errBody = await res.json()
          code = errBody.code ?? code
          serverMessage = errBody.message ?? serverMessage
        } catch {
          /* non-JSON error body */
        }
        handlers.onError({ code, message: streamErrorMessage(code, serverMessage) })
        return
      }
      if (!res.body) {
        handlers.onError({
          code: 'no_stream',
          message: streamErrorMessage('no_stream'),
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false
      let receivedAccumulated = false

      while (!done) {
        const { value, done: eof } = await reader.read()
        if (eof) break
        buffer += decoder.decode(value, { stream: true })

        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)

          let eventName = 'message'
          const dataLines: string[] = []
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
          }
          const payload = dataLines.join('\n')

          if (eventName === 'done') {
            handlers.onDone()
            return
          }
          if (eventName === 'citations') {
            try {
              const parsed = JSON.parse(payload) as SseCitations
              if (Array.isArray(parsed.sources)) handlers.onCitations?.(parsed.sources)
            } catch {
              /* ignore malformed citations frame */
            }
            continue
          }
          if (eventName === 'error') {
            let parsed: Partial<SseError> = {}
            try {
              parsed = JSON.parse(payload) as SseError
            } catch {
              /* malformed payload */
            }
            const code = parsed.code ?? 'stream_error'
            handlers.onError({
              code,
              message: streamErrorMessage(code, parsed.message),
            })
            return
          }
          if (payload) {
            try {
              const parsed = JSON.parse(payload) as SseDelta
              if (typeof parsed.delta === 'string') {
                // First delta from resume is the full accumulated text from the
                // backend — replace current content rather than append to avoid
                // duplicating the DB-cached partial text.
                if (!receivedAccumulated) {
                  receivedAccumulated = true
                  handlers.onDelta(parsed.delta, true)
                } else {
                  handlers.onDelta(parsed.delta, false)
                }
              }
            } catch {
              /* ignore malformed data frame */
            }
          }
        }
      }
      // Stream closed without an explicit done/error event.
      handlers.onDone()
    } catch (err) {
      if (controller.signal.aborted) return
      const fallback =
        err instanceof Error && err.message ? err.message : undefined
      handlers.onError({
        code: 'network_error',
        message: streamErrorMessage('network_error', fallback),
      })
    }
  })()

  return controller
}

export { API_BASE }
