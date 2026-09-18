import { ref, computed } from 'vue'
import { getMyQuota } from '@/api/quota'
import type { QuotaResponse } from '@/types/api'

/**
 * فاز ۵ — نمایش مانده سهمیه در چت.
 *
 * Loads the caller's quota and exposes derived helpers. `tokenLimit === 0`
 * is the backend's "unlimited" sentinel (admin accounts), so it is rendered
 * without a denominator.
 */
export function useQuota() {
  const quota = ref<QuotaResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadQuota(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      quota.value = await getMyQuota()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'خطا در دریافت سهمیه'
      quota.value = null
    } finally {
      loading.value = false
    }
  }

  const isUnlimited = computed(() => quota.value?.tokenLimit === 0)

  const isExhausted = computed(
    () => !!quota.value && quota.value.tokenLimit > 0 && quota.value.tokenRemaining <= 0,
  )

  const percentUsed = computed(() => {
    if (!quota.value || quota.value.tokenLimit <= 0) return 0
    return Math.min(100, Math.round((quota.value.tokenUsed / quota.value.tokenLimit) * 100))
  })

  const remainingLabel = computed(() => {
    if (!quota.value) return ''
    if (quota.value.tokenLimit === 0) return 'سهمیه نامحدود'
    return `${quota.value.tokenRemaining.toLocaleString('fa-IR')} از ${quota.value.tokenLimit.toLocaleString('fa-IR')} توکن`
  })

  /** Apply the post-stream balance returned by a refresh without a full reload. */
  function setQuota(next: QuotaResponse | null): void {
    quota.value = next
  }

  return {
    quota,
    loading,
    error,
    isUnlimited,
    isExhausted,
    percentUsed,
    remainingLabel,
    loadQuota,
    setQuota,
  }
}
