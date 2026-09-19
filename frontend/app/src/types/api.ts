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

/** فاز ۸ — توان استدلال مؤثر مدل (ناشناخته در سمت سرور به «پشتیبانی نمی‌شود» تبدیل می‌شود). */
export interface ReasoningCapability {
  supported: boolean
  output: 'none' | 'summary'
  streaming: boolean
}

export interface ModelPublic {
  id: string
  displayName: string
  isDefault: boolean
  /** فاز ۸ — فقط وقتی supported=true کنترل استدلال نمایش داده می‌شود. */
  reasoning?: ReasoningCapability
}

/**
 * Admin view of a model. The admin reasoning shape is deliberately different
 * from the public capability (`reasoning` here carries the discovery snapshot
 * and the manual values, not just the effective capability), so the inherited
 * field is omitted and re-declared.
 */
export interface ModelAdmin extends Omit<ModelPublic, 'reasoning'> {
  actualName: string
  providerId: string
  visibility: ModelVisibility
  enabled: boolean
  createdAt: string
  updatedAt: string
  /** فاز ۸ — پیکربندی استدلال مدل از دید مدیر. */
  reasoning?: AdminModelReasoning
}

/** فاز ۸ — پیکربندی استدلال مدل از دید مدیر. */
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
  /** فاز ۸ — پیکربندی استدلال. */
  reasoning?: ModelReasoningRequest
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
  /** فاز ۷ — منابع وبِ استنادشده در این پیام دستیار. */
  citations?: CitationSource[]
  /** فاز ۸ — استدلال برای این نوبت فعال بوده است. */
  reasoningEnabled?: boolean
  /** فاز ۸ — خلاصهٔ استدلال ارائه‌شده توسط ارائه‌دهنده (نه زنجیرهٔ فکر خصوصی). */
  reasoningSummary?: string | null
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessagePublic[]
}

export interface ChatRequest {
  conversationId?: string | null
  modelId?: string | null
  message: string
  /** فاز ۷ — جستجوی وب برای این نوبت. */
  webSearch?: boolean
  /** فاز ۸ — استدلال برای این نوبت. */
  reasoning?: boolean
}

export interface SseDelta {
  delta: string
}

export interface SseError {
  code: string
  message: string
}

/** فاز ۸ — فازهای چرخهٔ استدلال. */
export type ReasoningPhase = 'reasoning_started' | 'reasoning_completed' | 'answer_started'

/** فاز ۶/۷/۸ — رویداد وضعیت: تلاش مجدد، چرخهٔ جستجوی وب، یا چرخهٔ استدلال. */
export interface SseStatus {
  phase: 'retrying' | SearchPhase | ReasoningPhase
  attempt?: number
  maxAttempts?: number
  query?: string
  sources?: number
  credits?: number
}

/** فاز ۸ — یک تکه از خلاصهٔ استدلال قابل‌نمایش. */
export interface SseReasoningDelta {
  delta: string
}

/** فاز ۷ — منابع نهایی پاسخ، پیش از رویداد done. */
export interface SseCitations {
  sources: CitationSource[]
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

/** Phase 5 — Quotas & user usage display. */
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
