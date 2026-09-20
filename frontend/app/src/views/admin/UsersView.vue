<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { 
  PhMagnifyingGlass, 
  PhUsers, 
  PhCrown, 
  PhCaretRight, 
  PhCaretLeft, 
  PhArrowsClockwise 
} from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { listAdminUsers } from '@/api/admin'
import { formatDateTime } from '@/utils/time'
import { avatarValueFor } from '@/utils/avatar'
import type { AdminUser } from '@/types/api'

const items = ref<AdminUser[]>([])
const total = ref(0)
const search = ref('')
const loading = ref(false)
const initialLoading = ref(true)
const pageError = ref<ApiError | null>(null)

// Pagination state
const pageSize = 10
const currentPage = ref(1)

const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return items.value.slice(start, start + pageSize)
})

const totalPages = computed(() => Math.ceil(items.value.length / pageSize) || 1)

async function load(): Promise<void> {
  loading.value = true
  pageError.value = null
  try {
    const res = await listAdminUsers({ query: search.value.trim() || undefined, limit: 100 })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    pageError.value =
      err instanceof ApiError ? err : new ApiError(0, null, 'خطا در بارگذاری کاربران.')
  } finally {
    loading.value = false
    initialLoading.value = false
  }
}

onMounted(() => {
  void load()
})

const isEmpty = computed(() => !initialLoading.value && items.value.length === 0 && !pageError.value)
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6" dir="rtl">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <PhUsers class="size-5" aria-hidden="true" />
        </span>
        <div>
          <h1 class="text-xl font-bold text-ink">مدیریت کاربران</h1>
          <p class="text-sm text-ink-muted">بررسی اطلاعات حساب‌ها (مجموعاً {{ total }} کاربر).</p>
        </div>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-sm font-medium text-ink hover:bg-hover transition cursor-pointer"
        @click="load"
      >
        <PhArrowsClockwise class="size-4" :class="{ 'animate-spin': loading }" />
        <span>بروزرسانی</span>
      </button>
    </div>

    <!-- فرم جست‌وجو -->
    <form class="flex items-end gap-2" @submit.prevent="load">
      <BaseInput v-model="search" label="جست‌وجو" hint="ایمیل یا نام کاربری" autocomplete="off" />
      <BaseButton type="submit" :loading="loading">
        <PhMagnifyingGlass class="size-4" aria-hidden="true" />
        <span>جست‌وجو</span>
      </BaseButton>
    </form>

    <ErrorBanner
      v-if="pageError"
      :message="apiErrorMessage(pageError)"
      :code="pageError.code"
      :request-id="pageError.requestId"
      :show-code="true"
      class="mb-3"
    />

    <div v-if="initialLoading" class="h-48 animate-pulse rounded-card bg-surface" />

    <EmptyState
      v-else-if="isEmpty"
      title="کاربری پیدا نشد"
      description="عبارت جست‌وجو را تغییر دهید."
    />

    <!-- جدول کاربران -->
    <div v-else class="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <table class="w-full border-collapse text-right text-sm">
        <thead>
          <tr class="border-b border-line bg-elevated text-xs font-semibold text-ink-muted uppercase tracking-wide">
            <th class="p-3.5 text-right">کاربر</th>
            <th class="p-3.5 text-right">نام کاربری</th>
            <th class="p-3.5 text-right">ایمیل</th>
            <th class="p-3.5 text-right">نقش</th>
            <th class="p-3.5 text-right">تاریخ عضویت</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line text-ink">
          <tr
            v-for="u in paginatedItems"
            :key="u.id"
            class="hover:bg-hover/55 transition"
          >
            <td class="p-3.5">
              <div class="flex items-center gap-2.5">
                <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-elevated">
                  <UserAvatar :value="avatarValueFor(u as any)" :size="30" />
                </span>
                <span class="truncate font-medium">{{ u.username ?? '—' }}</span>
              </div>
            </td>
            <td class="p-3.5 font-mono text-xs text-ink-muted">{{ u.username ?? '—' }}</td>
            <td class="p-3.5 font-mono text-xs text-ink" dir="ltr">{{ u.email }}</td>
            <td class="p-3.5">
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                :class="u.role === 'admin' ? 'bg-accent/15 text-accent' : 'bg-primary/10 text-primary'"
              >
                <PhCrown v-if="u.role === 'admin'" class="size-3.5" />
                {{ u.role === 'admin' ? 'مدیر' : 'کاربر' }}
              </span>
            </td>
            <td class="p-3.5 text-xs text-ink-muted font-mono">{{ formatDateTime(u.createdAt) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- نوار صفحه‌بندی (Pagination) -->
      <div v-if="items.length > pageSize" class="flex items-center justify-between border-t border-line bg-elevated/50 px-4 py-3 text-sm">
        <span class="text-xs text-ink-muted">
          نمایش صفحه {{ currentPage }} از {{ totalPages }} (مجموعاً {{ items.length }} کاربر)
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            :disabled="currentPage === 1"
            @click="currentPage--"
          >
            <PhCaretRight class="size-3.5" />
            <span>قبلی</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            :disabled="currentPage >= totalPages"
            @click="currentPage++"
          >
            <span>بعدی</span>
            <PhCaretLeft class="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>