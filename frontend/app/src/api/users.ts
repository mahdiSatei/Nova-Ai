import { request } from '@/api/http'
import type { UserPublic } from '@/types/api'

export function getMe(): Promise<UserPublic> {
  return request<UserPublic>('/v1/users/me')
}

export function updateMe(body: { displayName: string }): Promise<UserPublic> {
  return request<UserPublic>('/v1/users/me', { method: 'PATCH', body })
}
