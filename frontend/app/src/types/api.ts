export type Role = 'user' | 'admin'
export type MessageRole = 'user' | 'assistant'

export interface UserPublic {
  id: string
  email: string
  username: string | null
  displayName: string | null
  role: Role
  createdAt: string
  lastLoginAt?: string | null
}

export interface AuthResponse {
  user: UserPublic
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
}

export interface LoginRequest {
  identifier: string
  password: string
}

export interface ErrorDetail {
  field: string
  message: string
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: ErrorDetail[] | Record<string, unknown>
  requestId: string
}

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

export interface ModelUpsertRequest {
  displayName?: string
  actualName?: string
  enabled?: boolean
}

export interface ModelList<T> {
  items: T[]
}

export interface CentralProviderPublic {
  baseUrl: string
  apiKeyMasked?: string
  isConfigured: boolean
  lastValidatedAt?: string | null
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

export interface ConversationSummary {
  id: string
  modelId: string
  title?: string | null
  pinned?: boolean
  createdAt: string
  updatedAt: string
}

export interface MessagePublic {
  id: string
  role: MessageRole
  content: string
  createdAt: string
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessagePublic[]
}

export interface ChatRequest {
  conversationId?: string | null
  modelId?: string | null
  message: string
}

export interface SseDelta {
  delta: string
}

export interface SseError {
  code: string
  message: string
}

export interface PaginatedQuery {
  limit?: number
  offset?: number
}
