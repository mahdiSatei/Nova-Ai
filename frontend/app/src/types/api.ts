export type Role = 'user' | 'admin'
export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'

/** فاز ۳ — سطح دسترسی مدل و کاربر. */
export type ModelVisibility = 'public' | 'commercial' | 'private'
export type UserAccessTier = 'free' | 'commercial'

export interface UserPublic {
  id: string
  email: string
  username: string | null
  displayName: string | null
  avatarSeed: string | null
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
  providerId: string
  visibility: ModelVisibility
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface ModelUpsertRequest {
  displayName?: string
  actualName?: string
  providerId?: string
  visibility?: ModelVisibility
  enabled?: boolean
}

export interface ModelList<T> {
  items: T[]
}

/** فاز ۳ — کاربر از دید مدیر (هیچ‌گاه شامل هش رمز نیست). */
export interface AdminUser {
  id: string
  email: string
  username: string | null
  role: Role
  accessTier: UserAccessTier
  createdAt: string
}

export interface AdminUserList {
  items: AdminUser[]
  total: number
}

export interface ProviderAdmin {
  id: string
  name: string
  type: string
  baseUrl: string
  hasApiKey: boolean
  isActive: boolean
  lastValidatedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ProviderUpdateRequest {
  baseUrl: string
  apiKey?: string
}

export interface ProviderList {
  items: ProviderAdmin[]
  total: number
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
  modelDisplayName?: string | null
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
  status: MessageStatus
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

/** Phase 4 — Usage & Cost Tracking */
export interface UsageRecord {
  id: string
  userId: string
  conversationId: string
  messageId: string | null
  modelId: string
  modelName: string | null
  providerId: string
  providerName: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
  status: 'pending' | 'completed' | 'failed'
  createdAt: string
  completedAt: string | null
}

export interface UsageReport {
  items: UsageRecord[]
  total: number
  totals: {
    totalTokens: number
    totalCost: number
    requestCount: number
  }
}
