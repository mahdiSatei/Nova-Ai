// Pinia store برای مدل‌های فعال قابل مشاهده توسط کاربر.
// طبق FR-007: فقط مدل‌های enabled را برمی‌گرداند. actualName هرگز به
// سمت کاربر ارسال نمی‌شود (BR-003، C6).
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as modelsApi from '@/api/models'
import type { ModelPublic } from '@/types/api'
import { ApiError } from '@/api/http'

export const useModelsStore = defineStore('models', () => {
  const items = ref<ModelPublic[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<ApiError | null>(null)

  const isEmpty = computed(() => loaded.value && items.value.length === 0)
  const defaultModelId = computed(() => items.value.find((m) => m.isDefault)?.id ?? null)

  async function load(force = false): Promise<void> {
    if (loading.value) return
    if (loaded.value && !force) return
    loading.value = true
    error.value = null
    try {
      const page = await modelsApi.listModels()
      items.value = page.items
      loaded.value = true
    } catch (err) {
      error.value = err instanceof ApiError ? err : new ApiError(0, null, 'خطا در بارگذاری مدل‌ها.')
    } finally {
      loading.value = false
    }
  }

  function byId(id: string | null | undefined): ModelPublic | null {
    if (!id) return null
    return items.value.find((m) => m.id === id) ?? null
  }

  function displayName(modelId: string | null | undefined, fallback = '—'): string {
    return byId(modelId)?.displayName ?? fallback
  }

  return { items, loading, loaded, error, isEmpty, defaultModelId, load, byId, displayName }
})
