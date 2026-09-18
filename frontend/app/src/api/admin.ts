import { request } from '@/api/http'
import type {
  AdminUser,
  AdminUserList,
  AppConfigPublic,
  AppConfigUpdateRequest,
  UserAccessTier,
  ProviderAdmin,
  ProviderList,
  ProviderUpdateRequest,
  ModelAdmin,
  ModelList,
  ModelUpsertRequest,
  PaginatedQuery,
} from '@/types/api'

export function listProviders(): Promise<ProviderList> {
  return request<ProviderList>('/v1/admin/providers')
}

export function getProvider(id?: string): Promise<ProviderAdmin> {
  const providerId = id ?? 'central'
  return request<ProviderAdmin>(`/v1/admin/providers/${providerId}`)
}

export function updateProvider(id: string, body: ProviderUpdateRequest): Promise<ProviderAdmin> {
  return request<ProviderAdmin>(`/v1/admin/providers/${id}`, { method: 'PATCH', body })
}

export function listAdminModels(query: PaginatedQuery = {}): Promise<ModelList<ModelAdmin>> {
  return request<ModelList<ModelAdmin>>('/v1/admin/models', { query: { ...query } })
}

export function createModel(body: Required<Pick<ModelUpsertRequest, 'displayName' | 'actualName'>> & ModelUpsertRequest): Promise<ModelAdmin> {
  return request<ModelAdmin>('/v1/admin/models', { method: 'POST', body })
}

export function updateModel(id: string, body: ModelUpsertRequest): Promise<ModelAdmin> {
  return request<ModelAdmin>(`/v1/admin/models/${id}`, { method: 'PATCH', body })
}

export interface DeleteModelMigrationResult {
  deleted: true
  migrated: {
    conversations: number
    users: number
    defaultSwitched: boolean
  }
}

export function deleteModel(
  id: string,
  migrateTo?: string | null,
): Promise<DeleteModelMigrationResult | undefined> {
  return request<DeleteModelMigrationResult | undefined>(`/v1/admin/models/${id}`, {
    method: 'DELETE',
    query: migrateTo ? { migrateTo } : undefined,
  })
}

// ── فاز ۳: سطح دسترسی کاربران ─────────────────────────────────────────────

export function listAdminUsers(
  query: { query?: string; limit?: number; offset?: number } = {},
): Promise<AdminUserList> {
  return request<AdminUserList>('/v1/admin/users', { query: { ...query } })
}

export function setUserAccessTier(id: string, accessTier: UserAccessTier): Promise<AdminUser> {
  return request<AdminUser>(`/v1/admin/users/${id}/access-tier`, {
    method: 'PATCH',
    body: { accessTier },
  })
}

export function getConfig(): Promise<AppConfigPublic> {
  return request<AppConfigPublic>('/v1/admin/config')
}

export function putConfig(body: AppConfigUpdateRequest): Promise<AppConfigPublic> {
  return request<AppConfigPublic>('/v1/admin/config', { method: 'PUT', body })
}
