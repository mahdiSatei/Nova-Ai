import { request } from '@/api/http'
import type { AuditLogList } from '@/types/api'

export function listAuditLogs(query: {
  action?: string
  actorId?: string
  targetType?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
} = {}): Promise<AuditLogList> {
  return request<AuditLogList>('/v1/admin/audit', { query: { ...query } })
}
