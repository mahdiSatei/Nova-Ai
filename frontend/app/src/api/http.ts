import type { ApiErrorBody } from '@/types/api'

export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

const ACCESS_KEY = 'mmcb.accessToken'
const REFRESH_KEY = 'mmcb.refreshToken'
const EXPIRES_KEY = 'mmcb.expiresAt'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export const tokenStore = {
  load(): TokenPair | null {
    const accessToken = localStorage.getItem(ACCESS_KEY)
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    const expiresAt = Number(localStorage.getItem(EXPIRES_KEY))
    if (!accessToken || !refreshToken) return null
    return { accessToken, refreshToken, expiresAt: expiresAt || 0 }
  },
  save(pair: TokenPair): void {
    localStorage.setItem(ACCESS_KEY, pair.accessToken)
    localStorage.setItem(REFRESH_KEY, pair.refreshToken)
    localStorage.setItem(EXPIRES_KEY, String(pair.expiresAt))
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(EXPIRES_KEY)
  },
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: ErrorDetailOrObject
  readonly requestId?: string

  constructor(status: number, body: Partial<ApiErrorBody> | null, fallbackMessage: string) {
    super(body?.message ?? fallbackMessage)
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code ?? 'unknown_error'
    this.details = body?.details
    this.requestId = body?.requestId
  }

  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    if (Array.isArray(this.details)) {
      for (const d of this.details) {
        if (d && typeof d.field === 'string') out[d.field] = d.message
      }
    }
    return out
  }
}

type ErrorDetailOrObject = NonNullable<ApiErrorBody['details']>

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  auth?: boolean
  signal?: AbortSignal
  /** internal: prevent recursive refresh loop */
  _retried?: boolean
}

export function buildUrl(path: string, query?: HttpOptions['query']): string {
  const url = `${API_BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function readError(res: Response): Promise<ApiErrorBody | null> {
  try {
    return (await res.json()) as ApiErrorBody
  } catch {
    return null
  }
}

let refreshInFlight: Promise<TokenPair | null> | null = null

export async function refreshTokens(): Promise<TokenPair | null> {
  if (refreshInFlight) return refreshInFlight
  const current = tokenStore.load()
  if (!current) return null
  refreshInFlight = (async () => {
    try {
      const res = await fetch(buildUrl('/v1/auth/refresh'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': newRequestId(),
        },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      })
      if (!res.ok) {
        tokenStore.clear()
        return null
      }
      const data = (await res.json()) as {
        accessToken: string
        refreshToken: string
        expiresIn: number
      }
      const pair: TokenPair = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + data.expiresIn * 1000,
      }
      tokenStore.save(pair)
      return pair
    } catch {
      tokenStore.clear()
      return null
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

let sessionExpiredHandler: (() => void) | null = null

export function onSessionExpired(handler: () => void): void {
  sessionExpiredHandler = handler
}

async function doFetch(path: string, opts: HttpOptions, accessToken: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'X-Request-ID': newRequestId(),
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false && accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })
}

export async function request<T>(path: string, opts: HttpOptions = {}): Promise<T> {
  const useAuth = opts.auth !== false
  let tokens = useAuth ? tokenStore.load() : null
  let res = await doFetch(path, opts, tokens?.accessToken ?? null)

  if (res.status === 401 && useAuth && tokens && !opts._retried) {
    const refreshed = await refreshTokens()
    if (refreshed) {
      res = await doFetch(path, { ...opts, _retried: true }, refreshed.accessToken)
    } else {
      sessionExpiredHandler?.()
    }
  }

  if (!res.ok) {
    const body = await readError(res)
    throw new ApiError(res.status, body, `Request failed with status ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function deleteRequest(path: string): Promise<void> {
  await request<void>(path, { method: 'DELETE' })
}
