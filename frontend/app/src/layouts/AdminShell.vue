<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import {
  PhGear,
  PhListBullets,
  PhPlugsConnected,
  PhSignOut,
  PhMoon,
  PhSun,
  PhUsers,
  PhChartBar,
  PhChatCircleText,
  PhUserGear,
  PhFileText,
  PhCurrencyCircleDollar,
  PhClipboardText,
} from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { avatarValueFor } from '@/utils/avatar'

const auth = useAuthStore()
const router = useRouter()
const { theme, toggleTheme } = useTheme()

const nav = [
  { to: { name: 'admin-provider' }, label: 'ارائه‌دهنده', icon: PhPlugsConnected },
  { to: { name: 'admin-models' }, label: 'کاتالوگ مدل‌ها', icon: PhListBullets },
  { to: { name: 'admin-users' }, label: 'سطح دسترسی کاربران', icon: PhUsers },
  { to: { name: 'admin-usage' }, label: 'گزارش مصرف', icon: PhChartBar },
  { to: { name: 'admin-payments' }, label: 'پرداخت‌ها', icon: PhCurrencyCircleDollar },
  { to: { name: 'admin-audit' }, label: 'گزارش عملیات', icon: PhClipboardText },
  { to: { name: 'admin-files' }, label: 'مدیریت فایل‌ها', icon: PhFileText },
]

const userMenuOpen = ref(false)
const profileLabel = computed(() => auth.user?.displayName ?? auth.user?.email ?? 'حساب کاربری')

async function onSignOut(): Promise<void> {
  await auth.signOut()
  await router.push('/admin/login')
}
</script>

<template>
  <div class="flex h-dvh overflow-hidden">
    <!-- سایدبار ادمین -->
    <aside class="flex w-72 shrink-0 flex-col border-r border-line bg-surface">
      <div class="flex h-14 items-center gap-2 border-b border-line px-4 font-semibold">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
          <PhGear class="size-4.5 text-accent" aria-hidden="true" />
        </span>
        <span>پنل مدیریت</span>
      </div>

      <nav class="flex flex-col gap-1 p-3" aria-label="ناوبری مدیر">
        <RouterLink
          v-for="item in nav"
          :key="item.label"
          :to="item.to"
          class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink [&.router-link-active]:bg-primary/15 [&.router-link-active]:text-ink"
        >
          <component :is="item.icon" class="size-4" aria-hidden="true" />
          {{ item.label }}
        </RouterLink>
      </nav>

      <!-- فوتر سایدبار ادمین -->
      <div class="mt-auto shrink-0 border-t border-line/70 p-2">
        <div class="relative">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-start text-sm text-ink-muted transition-colors hover:bg-hover"
            @click="userMenuOpen = !userMenuOpen"
          >
            <span class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-elevated">
              <UserAvatar :value="auth.user ? avatarValueFor(auth.user) : 'anonymous'" :size="28" />
            </span>
            <span class="min-w-0 flex-1 truncate">{{ profileLabel }}</span>
          </button>

          <div
            v-if="userMenuOpen"
            class="absolute bottom-full start-0 z-50 mb-2 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-2xl"
            role="menu"
            @keydown="(e: KeyboardEvent) => { if (e.key === 'Escape') userMenuOpen = false }"
          >
            <RouterLink
              to="/chat"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-hover"
              role="menuitem"
              @click="userMenuOpen = false"
            >
              <PhChatCircleText class="size-4 shrink-0" aria-hidden="true" />
              <span>چت</span>
            </RouterLink>

            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-ink transition-colors hover:bg-hover"
              role="menuitem"
            >
              <PhUserGear class="size-4 shrink-0" aria-hidden="true" />
              <span>ویرایش پروفایل</span>
            </button>

            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-danger transition-colors hover:bg-danger-soft"
              role="menuitem"
              @click="onSignOut"
            >
              <PhSignOut class="flip-rtl size-4 shrink-0" aria-hidden="true" />
              <span>خروج از حساب</span>
            </button>
          </div>
        </div>
      </div>
    </aside>

    <main class="min-w-0 flex-1 flex flex-col overflow-hidden">
      <!-- هدر بالای صفحه ادمین (دقیقا مشابه صفحه چت کاربر) -->
      <header class="flex h-14 shrink-0 items-center justify-end px-6 border-line bg-surface/50 backdrop-blur">
        <button
          type="button"
          class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:text-ink"
          :aria-label="theme === 'light' ? 'حالت تاریک' : 'حالت روشن'"
          :title="theme === 'light' ? 'تاریک' : 'روشن'"
          @click="toggleTheme"
        >
          <PhMoon v-if="theme === 'light'" class="size-4" aria-hidden="true" />
          <PhSun v-else class="size-4" aria-hidden="true" />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto px-6 py-10">
        <div class="mx-auto w-full max-w-4xl">
          <RouterView />
        </div>
      </div>
    </main>
  </div>
</template>