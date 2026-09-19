<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { listAdminUsers } from '@/api/admin'
import { formatDateTime, relativeTime } from '@/utils/time'
import { avatarValueFor } from '@/utils/avatar'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { PhCrown, PhCaretRight, PhCaretLeft, PhArrowsClockwise } from '@phosphor-icons/vue'
import type { UserPublic } from '@/types/api'

const users = ref<UserPublic[]>([])
const loading = ref(true)
const errorMessage = ref<string | null>(null)

// Pagination state
const pageSize = 10
const currentPage = ref(1)

const paginatedUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return users.value.slice(start, start + pageSize)
})

const totalPages = computed(() => Math.ceil(users.value.length / pageSize) || 1)

async function loadUsers() {
  loading.value = true
  errorMessage.value = null
  try {
    users.value = await listAdminUsers(100, 0)
  } catch (err: any) {
    errorMessage.value = err?.message || 'خطا در بارگذاری لیست کاربران.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadUsers()
})
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6" dir="rtl">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-ink">مدیریت کاربران</h1>
        <p class="text-sm text-ink-muted">مشاهده فهرست کاربران ثبت‌نام‌شده، نقش و آخرین زمان ورود آن‌ها.</p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-sm font-medium text-ink hover:bg-hover transition cursor-pointer"
        @click="loadUsers"
      >
        <PhArrowsClockwise class="size-4" :class="{ 'animate-spin': loading }" />
        <span>بروزرسانی</span>
      </button>
    </div>

    <!-- ارور در صورت بروز مشکل -->
    <div v-if="errorMessage" class="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      {{ errorMessage }}
    </div>

    <!-- جدول کاربران -->
    <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <table class="w-full border-collapse text-right">
        <thead>
          <tr class="border-b border-line bg-elevated text-xs font-semibold text-ink-muted">
            <th class="p-3.5 text-right">کاربر</th>
            <th class="p-3.5 text-right">نام کاربری</th>
            <th class="p-3.5 text-right">ایمیل</th>
            <th class="p-3.5 text-right w-28">نقش</th>
            <th class="p-3.5 text-right w-40">آخرین ورود</th>
            <th class="p-3.5 text-right w-40">تاریخ عضویت</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line text-sm text-ink">
          <tr v-if="loading && users.length === 0">
            <td colspan="6" class="p-8 text-center text-ink-muted">در حال بارگذاری کاربران...</td>
          </tr>
          <tr v-else-if="users.length === 0">
            <td colspan="6" class="p-8 text-center text-ink-muted">هنوز کاربری ثبت‌نام نکرده است.</td>
          </tr>
          <tr v-for="user in paginatedUsers" :key="user.id" class="hover:bg-hover/55 transition">
            <td class="p-3.5">
              <div class="flex items-center gap-2.5">
                <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-elevated">
                  <UserAvatar :value="avatarValueFor(user)" :size="30" />
                </span>
                <span class="truncate font-medium">{{ user.displayName ?? '—' }}</span>
              </div>
            </td>
            <td class="p-3.5 font-mono text-xs text-ink-muted">{{ user.username ?? '—' }}</td>
            <td class="p-3.5 text-xs" dir="ltr">{{ user.email }}</td>
            <td class="p-3.5">
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                :class="user.role === 'admin' ? 'bg-accent/15 text-accent' : 'bg-primary/10 text-primary'"
              >
                <PhCrown v-if="user.role === 'admin'" class="size-3.5" />
                {{ user.role === 'admin' ? 'مدیر' : 'کاربر' }}
              </span>
            </td>
            <td class="p-3.5 text-xs text-ink-muted">{{ user.lastLoginAt ? relativeTime(user.lastLoginAt) : 'هرگز' }}</td>
            <td class="p-3.5 text-xs text-ink-muted font-mono">{{ formatDateTime(user.createdAt) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- نوار صفحه‌بندی (Pagination) -->
      <div v-if="users.length > pageSize" class="flex items-center justify-between border-t border-line bg-elevated/50 px-4 py-3 text-sm">
        <span class="text-xs text-ink-muted">
          نمایش صفحه {{ currentPage }} از {{ totalPages }} (مجموعاً {{ users.length }} کاربر)
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
