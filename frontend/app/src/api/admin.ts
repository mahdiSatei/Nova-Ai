import { request } from '@/api/http'
import type {
  AdminUser,
  AppConfigPublic,
  AppConfigUpdateRequest,
  ApiKeyAdmin,
  DeleteModelMigrationResult,
  ModelAdmin,
  ModelList,
  ModelUpsertRequest,
  ProviderAdmin,
  ProviderUpdateRequest,
  UsageReport,
} from '@/types/api'

// ── Config ───────────────────────────────────────────────────────────────

export function getConfig(): Promise<AppConfigPublic> {
  return request<AppConfigPublic>('/v1/admin/config')
}

export function putConfig(body: AppConfigUpdateRequest): Promise<AppConfigPublic> {
  return request<AppConfigPublic>('/v1/admin/config', { method: 'PUT', body })
}

// ── Providers ────────────────────────────────────────────────────────────

export function listProviders(): Promise<{ items: ProviderAdmin[]; total: number }> {
  return request<{ items: ProviderAdmin[]; total: number }>('/v1/admin/providers')
}

export function createProvider(body: {
  id: string
  name: string
  type: string
  baseUrl: string
  apiKey: string
}): Promise<ProviderAdmin> {
  return request<ProviderAdmin>('/v1/admin/providers', { method: 'POST', body })
}

export function updateProvider(id: string, body: ProviderUpdateRequest): Promise<ProviderAdmin> {
  return request<ProviderAdmin>(`/v1/admin/providers/${id}`, { method: 'PATCH', body })
}

export function deleteProvider(id: string): Promise<void> {
  return request<void>(`/v1/admin/providers/${id}`, { method: 'DELETE' })
}

export function validateProvider(id: string): Promise<ProviderAdmin> {
  return request<ProviderAdmin>(`/v1/admin/providers/${id}/validate`, { method: 'POST' })
}

// ── API Keys ─────────────────────────────────────────────────────────────

export function listApiKeys(providerId: string): Promise<ApiKeyAdmin[]> {
  return request<ApiKeyAdmin[]>(`/v1/admin/providers/${providerId}/api-keys`)
}

export function addApiKey(
  providerId: string,
  body: { label: string; apiKey: string; isActive?: boolean },
): Promise<ApiKeyAdmin> {
  return request<ApiKeyAdmin>(`/v1/admin/providers/${providerId}/api-keys`, {
    method: 'POST',
    body,
  })
}

export function updateApiKey(
  providerId: string,
  keyId: string,
  body: { label?: string; apiKey?: string; isActive?: boolean },
): Promise<ApiKeyAdmin> {
  return request<ApiKeyAdmin>(`/v1/admin/providers/${providerId}/api-keys/${keyId}`, {
    method: 'PATCH',
    body,
  })
}

export function deleteApiKey(providerId: string, keyId: string): Promise<void> {
  return request<void>(`/v1/admin/providers/${providerId}/api-keys/${keyId}`, {
    method: 'DELETE',
  })
}

export function validateApiKey(providerId: string, keyId: string): Promise<ApiKeyAdmin> {
  return request<ApiKeyAdmin>(`/v1/admin/providers/${providerId}/api-keys/${keyId}/validate`, {
    method: 'POST',
  })
}

// ── Models ───────────────────────────────────────────────────────────────

export function listAdminModels(): Promise<ModelList<ModelAdmin>> {
  return request<ModelList<ModelAdmin>>('/v1/admin/models')
}

export function createModel(body: ModelUpsertRequest): Promise<ModelAdmin> {
  return request<ModelAdmin>('/v1/admin/models', { method: 'POST', body })
}

export function updateModel(id: string, body: ModelUpsertRequest): Promise<ModelAdmin> {
  return request<ModelAdmin>(`/v1/admin/models/${id}`, { method: 'PATCH', body })
}

export function deleteModel(
  id: string,
  migrateTo?: string,
): Promise<DeleteModelMigrationResult | void> {
  const query = migrateTo ? { migrateTo } : undefined
  return request<DeleteModelMigrationResult | void>(`/v1/admin/models/${id}`, {
    method: 'DELETE',
    query,
  })
}

export function discoverModelReasoning(id: string): Promise<ModelAdmin> {
  return request<ModelAdmin>(`/v1/admin/models/${id}/reasoning/discover`, { method: 'POST' })
}

export type { DeleteModelMigrationResult } from '@/types/api'

// ── Users ────────────────────────────────────────────────────────────────

export function listAdminUsers(opts: {
  query?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: AdminUser[]; total: number }> {
  return request<{ items: AdminUser[]; total: number }>('/v1/admin/users', {
    query: {
      ...(opts.query ? { query: opts.query } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
      ...(opts.offset ? { offset: opts.offset } : {}),
    },
  })
}

// ── Usage & Cost Tracking ────────────────────────────────────────────────

export function listAdminUsage(query: {
  userId?: string
  modelId?: string
  providerId?: string
  status?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
} = {}): Promise<UsageReport> {
  return request<UsageReport>('/v1/admin/usage', { query: { ...query } })
}

// ── Files ────────────────────────────────────────────────────────────────

export interface AdminFileRecord {
  id: string
  originalName: string
  mimeType: string
  size: number
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  errorMessage: string | null
  createdAt: string
  userId: string
  username: string
}

export async function listAdminFiles(
  limit = 50,
  offset = 0,
  filters: { status?: string; mimeType?: string; userId?: string } = {},
): Promise<{ items: AdminFileRecord[]; total: number }> {
  return request<{ items: AdminFileRecord[]; total: number }>('/v1/admin/files', {
    query: {
      limit: String(limit),
      offset: String(offset),
      ...filters,
    },
  })
}

// ── Payments (admin) ─────────────────────────────────────────────────────

export function listAdminPayments(query: {
  status?: string
  userId?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: unknown[]; total: number }> {
  return request('/v1/admin/payments', { query: { ...query } })
}

export function listAdminCreditPurchases(query: {
  status?: string
  userId?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: unknown[]; total: number }> {
  return request('/v1/admin/credit-purchases', { query: { ...query } })
}

export function reconcilePayment(id: string): Promise<unknown> {
  return request(`/v1/admin/payments/${id}/reconcile`, { method: 'POST' })
}