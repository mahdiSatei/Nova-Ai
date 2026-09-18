<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { PhGear, PhListBullets, PhPlugsConnected, PhSignOut, PhStar, PhMoon, PhSun, PhChatCircleText, PhUserGear } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
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
  { to: { name: 'admin-default-model' }, label: 'مدل پیش‌فرض', icon: PhStar },
]

const userMenuOpen = ref(false)
const profileLabel = computed(() => auth.user?.displayName ?? auth.user?.email ?? 'حساب کاربری')

async function onSignOut(): Promise<void> {
  await auth.signOut()
  await router.push('/admin/login')
}
</script>

<template>
  <div class="flex min-h-screen">
    <aside class="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div class="flex h-14 items-center gap-2 border-b border-line px-4 font-semibold">
        <PhGear class="size-5 text-accent" aria-hidden="true" />
        <span>مدیر</span>
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
      <div class="mt-auto flex flex-col gap-1 p-3">
        <BaseButton variant="ghost" size="sm" class="w-full justify-start" @click="toggleTheme">
          <PhSun v-if="theme === 'dark'" class="size-4" aria-hidden="true" />
          <PhMoon v-else class="size-4" aria-hidden="true" />
          {{ theme === 'dark' ? 'حالت روشن' : 'حالت تاریک' }}
        </BaseButton>

        <!-- منوی حساب کاربری: پروفایل / چت / خروج -->
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

    <main class="min-w-0 flex-1">
      <div class="mx-auto w-full max-w-3xl px-6 py-10">
        <RouterView />
      </div>
    </main>
  </div>
</template>
