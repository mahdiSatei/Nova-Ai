<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { PhChatCircleText, PhClockCounterClockwise, PhSignOut } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const initials = computed(() => auth.user?.email.slice(0, 2).toUpperCase() ?? '··')

async function onSignOut(): Promise<void> {
  await auth.signOut()
  await router.push('/login')
}
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div class="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
        <RouterLink to="/chat" class="flex items-center gap-2 font-semibold" aria-label="چت‌بات چند مدله">
          <PhChatCircleText class="size-5 text-primary" aria-hidden="true" />
          <span class="hidden sm:inline">چت‌بات چند مدله</span>
        </RouterLink>

        <div class="ms-auto flex items-center gap-1 sm:gap-2">
          <RouterLink
            to="/history"
            class="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-elevated hover:text-ink"
          >
            <PhClockCounterClockwise class="size-4" aria-hidden="true" />
            <span class="hidden sm:inline">تاریخچه</span>
          </RouterLink>
          <span class="hidden rounded-full bg-elevated px-3 py-1 text-xs text-ink-muted sm:inline" :title="auth.user?.email">
            {{ initials }}
          </span>
          <BaseButton variant="ghost" size="sm" @click="onSignOut">
            <PhSignOut class="flip-rtl size-4" aria-hidden="true" />
            <span class="hidden sm:inline">خروج</span>
          </BaseButton>
        </div>
      </div>
    </header>

    <div class="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4">
      <RouterView />
    </div>
  </div>
</template>
