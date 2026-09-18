<script setup lang="ts">
// فاز ۳ — سطح دسترسی کاربران: مدل‌های «تجاری» فقط برای کاربرانی نمایش داده
// می‌شوند که سطح دسترسی‌شان «تجاری» باشد. مدل‌های «خصوصی» تنها برای مدیران
// قابل استفاده‌اند. این صفحه فقط همین یک قابلیت را مدیریت می‌کند؛ مدیریت
// حساب کاربران (ساخت/غیرفعال‌سازی) خارج از دامنه است.
import { computed, ref } from 'vue'
import { PhMagnifyingGlass, PhUsers } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { listAdminUsers, setUserAccessTier } from '@/api/admin'
import type { AdminUser, UserAccessTier } from '@/types/api'

const items = ref<AdminUser[]>([])
const total = ref(0)
const search = ref('')
const loading = ref(false)
const initialLoading = ref(true)
const pageError = ref<ApiError | null>(null)
const actionError = ref<ApiError | null>(null)
const savingId = ref<string | null>(null)

const TIER_LABELS: Record<UserAccessTier, string> = {
  free: 'رایگان',
  commercial: 'تجاری',
}

async function load(): Promise<void> {
  loading.value = true
  pageError.value = null
  try {
    const res = await listAdminUsers({ query: search.value.trim() || undefined, limit: 50 })
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
void load()

async function onTierChange(user: AdminUser, value: string): Promise<void> {
  const next = value as UserAccessTier
  if (next === user.accessTier) return
  actionError.value = null
  savingId.value = user.id
  const previous = user.accessTier
  // خوش‌بینانه: انتخابگر بی‌درنگ پاسخ می‌دهد و در صورت خطا برمی‌گردد.
  user.accessTier = next
  try {
    const updated = await setUserAccessTier(user.id, next)
    user.accessTier = updated.accessTier
  } catch (err) {
    user.accessTier = previous
    actionError.value =
      err instanceof ApiError ? err : new ApiError(0, null, 'خطا در ذخیره سطح دسترسی.')
  } finally {
    savingId.value = null
  }
}

const isEmpty = computed(() => !initialLoading.value && items.value.length === 0 && !pageError.value)
</script>

<template>
  <section>
    <header class="mb-4 flex items-center gap-3">
      <PhUsers class="size-5 text-primary" aria-hidden="true" />
      <h1 class="text-base font-semibold">سطح دسترسی کاربران</h1>
      <span class="text-xs text-ink-muted">{{ total }} کاربر</span>
    </header>

    <p class="mb-4 text-sm text-ink-muted">
      مدل‌های «تجاری» فقط برای کاربران با سطح دسترسی «تجاری» نمایش داده می‌شوند. مدل‌های «خصوصی»
      تنها برای مدیران قابل استفاده‌اند.
    </p>

    <form class="mb-4 flex items-end gap-2" @submit.prevent="load">
      <BaseInput v-model="search" label="جست‌وجو" hint="ایمیل یا نام کاربری" autocomplete="off" />
      <BaseButton type="submit" :loading="loading">
        <PhMagnifyingGlass class="size-4" aria-hidden="true" />
        <span>جست‌وجو</span>
      </BaseButton>
    </form>

    <ErrorBanner
      v-if="actionError"
      :message="apiErrorMessage(actionError)"
      :code="actionError.code"
      :request-id="actionError.requestId"
      :show-code="true"
      class="mb-3"
    />
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

    <div v-else class="overflow-x-auto rounded-card border border-line bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line bg-elevated/40 text-xs uppercase tracking-wide text-ink-muted">
            <th class="px-4 py-2.5 text-start font-medium">ایمیل</th>
            <th class="px-4 py-2.5 text-start font-medium">نام کاربری</th>
            <th class="px-4 py-2.5 text-start font-medium">نقش</th>
            <th class="px-4 py-2.5 text-start font-medium">سطح دسترسی</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in items"
            :key="u.id"
            class="border-b border-line last:border-b-0 transition-colors hover:bg-elevated/30"
          >
            <td class="px-4 py-3 font-mono text-xs text-ink" dir="ltr">{{ u.email }}</td>
            <td class="px-4 py-3 text-ink-muted">{{ u.username ?? '—' }}</td>
            <td class="px-4 py-3 text-ink-muted">{{ u.role === 'admin' ? 'مدیر' : 'کاربر' }}</td>
            <td class="px-4 py-3">
              <select
                :value="u.accessTier"
                :disabled="savingId === u.id"
                :aria-label="`سطح دسترسی ${u.email}`"
                class="cursor-pointer appearance-none rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink transition-colors focus:border-primary disabled:opacity-50"
                @change="onTierChange(u, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="(label, value) in TIER_LABELS" :key="value" :value="value">
                  {{ label }}
                </option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
