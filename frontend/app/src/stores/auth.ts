import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authApi from '@/api/auth'
import { onSessionExpired, refreshTokens, tokenStore, type TokenPair } from '@/api/http'
import type { LoginRequest, RegisterRequest, UserPublic } from '@/types/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserPublic | null>(null)
  const ready = ref(false)

  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === 'admin')

  function applySession(user_: UserPublic, pair: TokenPair): void {
    user.value = user_
    tokenStore.save(pair)
  }

  function pairFromExpires(accessToken: string, refreshToken: string, expiresIn: number): TokenPair {
    return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 }
  }

  /** Restores the session on app start (A6: state survives reload). */
  async function restore(): Promise<void> {
    const stored = tokenStore.load()
    if (!stored) {
      ready.value = true
      return
    }
    if (Date.now() > stored.expiresAt - 5_000) {
      const refreshed = await refreshTokens()
      if (!refreshed) {
        user.value = null
        ready.value = true
        return
      }
    }
    // The JWT's claims are not parsed (opaque ids per §7.9); the stored user
    // record gives us id/email/role for UI routing decisions.
    const cached = localStorage.getItem('mmcb.user')
    if (cached) {
      try {
        user.value = JSON.parse(cached) as UserPublic
      } catch {
        user.value = null
      }
    }
    if (!user.value) tokenStore.clear()
    ready.value = true
  }

  function persistUser(u: UserPublic | null): void {
    if (u) localStorage.setItem('mmcb.user', JSON.stringify(u))
    else localStorage.removeItem('mmcb.user')
  }

  async function register(req: RegisterRequest): Promise<UserPublic> {
    const res = await authApi.register(req)
    applySession(res.user, pairFromExpires(res.accessToken, res.refreshToken, res.expiresIn))
    persistUser(res.user)
    return res.user
  }

  async function login(req: LoginRequest): Promise<UserPublic> {
    const res = await authApi.login(req)
    applySession(res.user, pairFromExpires(res.accessToken, res.refreshToken, res.expiresIn))
    persistUser(res.user)
    return res.user
  }

  async function adminLogin(req: LoginRequest): Promise<UserPublic> {
    const res = await authApi.adminLogin(req)
    applySession(res.user, pairFromExpires(res.accessToken, res.refreshToken, res.expiresIn))
    persistUser(res.user)
    return res.user
  }

  function clearSession(): void {
    user.value = null
    tokenStore.clear()
    persistUser(null)
  }

  /** Replace the cached profile (e.g. after PATCH /v1/users/me). */
  function updateProfile(updated: UserPublic): void {
    user.value = updated
    persistUser(updated)
  }

  async function signOut(): Promise<void> {
    try {
      await authApi.logout()
    } catch {
      /* the session is being destroyed regardless (FR-006) */
    }
    clearSession()
  }

  onSessionExpired(clearSession)

  return { user, ready, isAuthenticated, isAdmin, restore, register, login, adminLogin, signOut, clearSession, updateProfile }
})
