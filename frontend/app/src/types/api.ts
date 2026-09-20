// Shared API contract types (combining full capabilities: reasoning, citations, providers, and files).

export type ModelVisibility = 'public' | 'commercial' | 'private'
export type UserAccessTier = 'free' | 'commercial'

/** Frontend-only mirror of the backend MessageStatus type. */
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'

/** Frontend-only mirror of the backend Message.role type. */
export type MessageRole = 'user' | 'assistant'

export type Role = 'user' | 'admin'

/** شکل خطا برگردانده‌شده توسط API. */
export interface ApiErrorBody {
  code?: string
  message?: string
  details?: Array<{ field: string; message: string }> | Record<string, unknown>
  requestId?: string
}

export interface PaginatedQuery {
  limit?: number
  offset?: number
}

// ─── auth & users ──────────────────────────────────────────────────────────

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

// ─── models & reasoning ────────────────────────────────────────────────────

/** فاز ۸ — توان استدلال مؤثر مدل */
export interface ReasoningCapability {
  supported: boolean
  output: 'none' | 'summary'
  streaming: boolean
}

export interface ModelPublic {
  id: string
  displayName: string
  isDefault: boolean
  reasoning?: ReasoningCapability
}

export interface ModelAdmin extends Omit<ModelPublic, 'reasoning'> {
  actualName: string
  providerId?: string
  visibility?: ModelVisibility
  enabled: boolean
  fallbackModelId?: string | null
  preferredApiKeyId?: string | null
  createdAt: string
  updatedAt: string
  reasoning?: AdminModelReasoning
}

export interface ModelList<T> {
  items: T[]
}

export type ReasoningConfigMode = 'automatic' | 'manual'
export type ReasoningOutput = 'none' | 'summary'
export type ReasoningCapabilitySource = 'provider_api' | 'provider_rules' | 'manual' | 'unknown'

export interface AdminReasoningCapability {
  supported: boolean | null
  output: ReasoningOutput | null
  streaming: boolean | null
}

export interface AdminModelReasoning {
  mode: ReasoningConfigMode
  effective: {
    supported: boolean | null
    output: ReasoningOutput | null
    streaming: boolean | null
    configurationSource: ReasoningConfigMode
  }
  discovered: AdminReasoningCapability & {
    sources: {
      supported: ReasoningCapabilitySource
      output: ReasoningCapabilitySource
      streaming: ReasoningCapabilitySource
    }
    discoveredAt: string | null
  }
  manual: AdminReasoningCapability
}

export interface ModelReasoningRequest {
  mode?: ReasoningConfigMode
  supported?: boolean | null
  output?: ReasoningOutput | null
  streaming?: boolean | null
}

export interface ModelUpsertRequest {
  displayName?: string
  actualName?: string
  providerId?: string
  visibility?: ModelVisibility
  enabled?: boolean
  fallbackModelId?: string | null
  preferredApiKeyId?: string | null
  reasoning?: ModelReasoningRequest
}

export interface DeleteModelMigrationResult {
  deleted: true
  migrated: {
    conversations: number
    users: number
    defaultSwitched: boolean
  }
}

// ─── admin users & providers ───────────────────────────────────────────────

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
  apiKeys?: ApiKeyAdmin[]
}

export interface ProviderUpdateRequest {
  name?: string
  baseUrl?: string
  apiKey?: string
  isActive?: boolean
}

export interface ProviderList {
  items: ProviderAdmin[]
  total: number
}

export interface ApiKeyAdmin {
  id: string
  label: string
  isActive: boolean
  lastValidatedAt: string | null
  failureCount: number
  createdAt: string
  updatedAt: string
}

// ─── app config ───────────────────────────────────────────────────────────

export interface AppConfigPublic {
  defaultModelId: string | null
}

export interface AppConfigUpdateRequest {
  defaultModelId: string | null
}

// ─── conversations & messages ──────────────────────────────────────────────

export interface ConversationSummary {
  id: string
  modelId: string
  modelDisplayName?: string | null
  title?: string | null
  pinned?: boolean
  createdAt: string
  updatedAt: string
}

export interface CitationSource {
  id: string
  title: string
  url: string
  snippet: string
}

export type SearchPhase =
  | 'search_started'
  | 'search_completed'
  | 'retrieval_started'
  | 'retrieval_completed'
  | 'generating'

export interface MessagePublic {
  id: string
  role: MessageRole
  content: string
  createdAt: string
  status: MessageStatus
  citations?: CitationSource[]
  reasoningEnabled?: boolean
  reasoningSummary?: string | null
  fileId?: string | null
  file?: {
    id: string
    originalName: string
    mimeType: string
    size: number
    status: string
  } | null
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessagePublic[]
}

// ─── chat / SSE ────────────────────────────────────────────────────────────

export interface ChatRequest {
  conversationId?: string | null
  modelId?: string | null
  message: string
  webSearch?: boolean
  reasoning?: boolean
  fileId?: string | null
}

export interface SseDelta {
  delta: string
}

export interface SseError {
  code?: string
  message?: string
}

export type ReasoningPhase = 'reasoning_started' | 'reasoning_completed' | 'answer_started'

export interface SseStatus {
  phase: 'retrying' | SearchPhase | ReasoningPhase
  attempt?: number
  maxAttempts?: number
  query?: string
  sources?: number
  credits?: number
}

export interface SseReasoningDelta {
  delta: string
}

export interface SseCitations {
  sources: CitationSource[]
}

// ─── usage & quotas ────────────────────────────────────────────────────────

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

export interface QuotaResponse {
  tokenLimit: number
  tokenUsed: number
  tokenRemaining: number
  costLimit: number | null
  resetAt: string | null
}

export interface QuotaRuleAdmin {
  id: string
  tier: string
  tokenLimit: number
  label: string
  createdAt: string
}

export interface QuotaRuleList {
  items: QuotaRuleAdmin[]
}