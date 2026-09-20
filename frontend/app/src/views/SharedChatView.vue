<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { PhSpinner } from '@phosphor-icons/vue'
import { getSharedSnapshot, type SharedSnapshot } from '@/api/sharing'

const route = useRoute()
const snapshot = ref<SharedSnapshot | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const shareId = route.params.shareId as string
    snapshot.value = await getSharedSnapshot(shareId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'گفتگوی اشتراک‌گذاری شده یافت نشد.'
  } finally {
    loading.value = false
  }
})

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
</script>

<template>
  <div class="flex h-dvh flex-col bg-background">
    <!-- Header -->
    <header class="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
      <h1 class="text-sm font-semibold text-ink truncate">
        {{ snapshot?.title ?? 'گفتگوی اشتراکی' }}
      </h1>
      <span v-if="snapshot?.modelDisplayName" class="shrink-0 rounded-md bg-elevated px-2 py-0.5 text-xs text-ink-muted">
        {{ snapshot.modelDisplayName }}
      </span>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <PhSpinner class="size-6 animate-spin text-accent" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center">
      <p class="text-sm text-danger">{{ error }}</p>
    </div>

    <!-- Messages -->
    <div v-else-if="snapshot" class="flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div
          v-for="(msg, idx) in snapshot.messages"
          :key="idx"
          class="flex gap-3"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
            :class="msg.role === 'user'
              ? 'bg-primary/10 text-ink'
              : 'bg-elevated text-ink'"
          >
            <div class="whitespace-pre-wrap">{{ msg.content }}</div>
            <div class="mt-1 text-[10px] text-ink-muted/60">
              {{ formatTime(msg.createdAt) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="shrink-0 border-t border-line px-6 py-3 text-center text-xs text-ink-muted/60">
      این گفتگو از طریق لینک اشتراک‌گذاری به اشتراک گذاشته شده است
    </footer>
  </div>
</template>
