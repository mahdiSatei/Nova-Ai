import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWalletBalance } from '@/api/wallet'

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
      const result = await getWalletBalance()
      balance.value = result.creditBalance
    } catch {
      // silent — balance widget shows last known value
    } finally {
      loading.value = false
    }
  }

  return { balance, loading, formattedBalance, refresh }
})
