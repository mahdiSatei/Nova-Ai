import { request } from '@/api/http'
import type { QuotaResponse } from '@/types/api'

/** فاز ۵ — مانده سهمیه کاربر جاری. */
export function getMyQuota(): Promise<QuotaResponse> {
  return request<QuotaResponse>('/v1/users/me/quota')
}
