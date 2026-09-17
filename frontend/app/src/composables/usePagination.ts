// Generic pagination: الگوی «نمایش موارد بیشتر» با offset/limit (OQ-007: پیش‌فرض 20، سقف 100).
// fetcher باید آرایه‌ای از آیتم‌ها برگرداند. سازگار با conversations list و admin models list.
import { ref, type Ref } from 'vue'
import { ApiError } from '@/api/http'

export interface PageFetcher<T> {
  (query: { limit: number; offset: number }): Promise<{ items: T[] }>
}

export interface UsePaginationOptions {
  limit?: number
}

export interface UsePaginationReturn<T> {
  items: Ref<T[]>
  loading: Ref<boolean>
  initialLoading: Ref<boolean>
  hasMore: Ref<boolean>
  error: Ref<ApiError | null>
  loadMore: () => Promise<void>
  retry: () => Promise<void>
  remove: (predicate: (item: T) => boolean) => void
  refresh: () => Promise<void>
}

export function usePagination<T>(fetcher: PageFetcher<T>, opts: UsePaginationOptions = {}): UsePaginationReturn<T> {
  const limit = opts.limit ?? 20
  const items = ref<T[]>([]) as Ref<T[]>
  const loading = ref(false)
  const initialLoading = ref(true)
  const hasMore = ref(true)
  const error = ref<ApiError | null>(null)
  let offset = 0

  async function loadMore(): Promise<void> {
    if (loading.value || !hasMore.value) return
    loading.value = true
    error.value = null
    try {
      const page = await fetcher({ limit, offset })
      items.value.push(...page.items)
      offset += page.items.length
      hasMore.value = page.items.length === limit
    } catch (err) {
      error.value = err instanceof ApiError ? err : new ApiError(0, null, 'خطا در بارگذاری.')
    } finally {
      loading.value = false
      initialLoading.value = false
    }
  }

  async function refresh(): Promise<void> {
    items.value = []
    offset = 0
    hasMore.value = true
    initialLoading.value = true
    error.value = null
    await loadMore()
  }

  function remove(predicate: (item: T) => boolean): void {
    items.value = items.value.filter((it) => !predicate(it))
  }

  void loadMore()

  return { items, loading, initialLoading, hasMore, error, loadMore, retry: refresh, remove, refresh }
}
