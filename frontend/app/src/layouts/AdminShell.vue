<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { PhGear, PhListBullets, PhPlugsConnected, PhSignOut, PhStar } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const nav = [
  { to: { name: 'admin-provider' }, label: 'ارائه‌دهنده', icon: PhPlugsConnected },
  { to: { name: 'admin-models' }, label: 'کاتالوگ مدل‌ها', icon: PhListBullets },
  { to: { name: 'admin-default-model' }, label: 'مدل پیش‌فرض', icon: PhStar },
]

async function onSignOut(): Promise<void> {
  await auth.signOut()
  await router.push('/login')
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
      <div class="mt-auto p-3">
        <BaseButton variant="ghost" size="sm" class="w-full justify-start" @click="onSignOut">
          <PhSignOut class="flip-rtl size-4" aria-hidden="true" />
          خروج
        </BaseButton>
      </div>
    </aside>

    <main class="min-w-0 flex-1">
      <div class="mx-auto w-full max-w-3xl px-6 py-10">
        <RouterView />
      </div>
    </main>
  </div>
</template>
