// Shared API contract types (mirrors specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml).
// Type-only module: never import runtime values here.

// ─── errors ────────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  code?: string
  message?: string
  details?: Array<{ field: string; message: string }> | Record<string, string>
  requestId?: string
}

// ─── shared query ──────────────────────────────────────────────────────────

export interface PaginatedQuery {
  limit?: number
  offset?: number
}

// ─── auth ──────────────────────────────────────────────────────────────────

export interface LoginRequest {
  identifier: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  username?: string
}

export interface UserPublic {
  id: string
  email: string
  username: string | null
  displayName: string | null
  avatarSeed: string | null
  role: 'user' | 'admin'
  createdAt: string
  lastLoginAt: string | null
}

export interface AuthResponse {
  user: UserPublic
  accessToken: string
  refreshToken: string
  expiresIn: number
}

// ─── models ────────────────────────────────────────────────────────────────

export interface ModelPublic {
  id: string
  displayName: string
  isDefault: boolean
}

export interface ModelAdmin extends ModelPublic {
  actualName: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface ModelList<T> {
  items: T[]
}

export interface ModelUpsertRequest {
  displayName?: string
  actualName?: string
  enabled?: boolean
}

// ─── central provider / app config (admin) ─────────────────────────────────

export interface CentralProviderPublic {
  baseUrl: string
  apiKeyMasked?: string
  isConfigured: boolean
  lastValidatedAt: string | null
}

export interface CentralProviderUpdateRequest {
  baseUrl: string
  apiKey: string
}

export interface AppConfigPublic {
  defaultModelId: string | null
}

export interface AppConfigUpdateRequest {
  defaultModelId: string | null
}

// ─── conversations & messages ──────────────────────────────────────────────

export type MessageStatus =
  | 'pending'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface MessagePublic {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  status: MessageStatus
  fileId?: string | null
  file?: {
    id: string
    originalName: string
    mimeType: string
    size: number
    status: string
  } | null
}

export interface ConversationSummary {
  id: string
  modelId: string
  title: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessagePublic[]
}

// ─── chat / SSE ────────────────────────────────────────────────────────────

export interface ChatRequest {
  message: string
  conversationId?: string
  modelId?: string
  fileId?: string | null
}

export interface SseDelta {
  delta: string
}

export interface SseError {
  code?: string
  message?: string
}
