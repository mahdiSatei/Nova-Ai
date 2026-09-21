import { request } from '@/api/http'
import type { UserUsageSummary } from '@/types/api'

export function getMyUsageSummary(): Promise<UserUsageSummary> {
  return request<UserUsageSummary>('/v1/usage/me')
}
