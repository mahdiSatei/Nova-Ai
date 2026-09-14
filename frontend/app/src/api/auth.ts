import { request } from '@/api/http'
import type { AuthResponse, LoginRequest, RegisterRequest } from '@/types/api'

export function register(body: RegisterRequest): Promise<AuthResponse> {
  return request<AuthResponse>('/v1/auth/register', { method: 'POST', body, auth: false })
}

export function login(body: LoginRequest): Promise<AuthResponse> {
  return request<AuthResponse>('/v1/auth/login', { method: 'POST', body, auth: false })
}

export function logout(): Promise<void> {
  return request<void>('/v1/auth/logout', { method: 'POST', body: {} })
}

