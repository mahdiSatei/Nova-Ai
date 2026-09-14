import { request } from '@/api/http'
import type {
  AppConfigPublic,
  AppConfigUpdateRequest,
  CentralProviderPublic,
  CentralProviderUpdateRequest,
  ModelAdmin,
  ModelList,
  ModelUpsertRequest,
  PaginatedQuery,
} from '@/types/api'

export function getProvider(): Promise<CentralProviderPublic> {
  return request<CentralProviderPublic>('/v1/admin/provider')
}

export function updateProvider(body: CentralProviderUpdateRequest): Promise<CentralProviderPublic> {
  return request<CentralProviderPublic>('/v1/admin/provider', { method: 'PUT', body })
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

export function deleteModel(id: string): Promise<void> {
  return request<void>(`/v1/admin/models/${id}`, { method: 'DELETE' })
}

export function getConfig(): Promise<AppConfigPublic> {
  return request<AppConfigPublic>('/v1/admin/config')
}

export function putConfig(body: AppConfigUpdateRequest): Promise<AppConfigPublic> {
  return request<AppConfigPublic>('/v1/admin/config', { method: 'PUT', body })
}
