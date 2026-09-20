<script setup lang="ts">
// پوسته‌ی کاربر: نوار کنایی (جمع‌شونده/کشویی) + ناحیه‌ی اصلی تمام‌ارتفاع.
import { ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { PhList, PhChatCircleText } from '@phosphor-icons/vue'
import ChatSidebar from '@/components/chat/ChatSidebar.vue'

const route = useRoute()
const drawerOpen = ref(false)

// با تغییر مسیر، کشوی موبایل بسته شود.
watch(() => route.fullPath, () => (drawerOpen.value = false))
</script>

<template>
  <div class="app-shell-bg flex h-dvh overflow-hidden">
    <ChatSidebar v-model:mobile-open="drawerOpen" @navigate="drawerOpen = false" />

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- نوار بالایی موبایل -->
      <header
        class="flex h-14 shrink-0 items-center gap-2 border-b border-line/70 bg-surface/75 px-3 shadow-sm backdrop-blur-xl lg:hidden"
      >
        <button
          type="button"
          class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          aria-label="باز کردن منو"
          @click="drawerOpen = true"
        >
          <PhList class="size-5" aria-hidden="true" />
        </button>
        <span class="flex items-center gap-1.5 text-sm font-semibold">
          <PhChatCircleText class="size-4 text-primary" aria-hidden="true" />
          Nova AI
        </span>
      </header>

      <main class="flex min-h-0 flex-1 flex-col overflow-hidden px-2 sm:px-4"><Transition name="page" mode="out-in"><RouterView />
        </Transition></main>
    </div>
  </div>
</template>
