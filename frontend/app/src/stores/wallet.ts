import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getMe } from '@/api/users'

export const useWalletStore = defineStore('wallet', () => {
  const balance = ref(0)
  const loading = ref(false)

  const formattedBalance = computed(() => {
    return balance.value.toLocaleString('fa-IR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  })

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const user = await getMe()
      // Balance is included in the user profile response if the backend exposes it.
      if ('creditBalance' in user) {
        balance.value = (user as Record<string, unknown>).creditBalance as number ?? 0
      }
    } catch {
      // silent — balance widget shows last known value
    } finally {
      loading.value = false
    }
  }

  return { balance, loading, formattedBalance, refresh }
})
