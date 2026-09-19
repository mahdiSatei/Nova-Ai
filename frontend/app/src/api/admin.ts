export function putConfig(body: AppConfigUpdateRequest): Promise<AppConfigPublic> {
  return request<AppConfigPublic>('/v1/admin/config', { method: 'PUT', body })
}

// ── Phase 4: Usage & Cost Tracking ──────────────────────────────────────────

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

export interface AdminFileRecord {
  id: string
  originalName: string
  mimeType: string
  size: number
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  errorMessage: string | null
  createdAt: string
  userId: string
  username: string // فیلد جدید
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