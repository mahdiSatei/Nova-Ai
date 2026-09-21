<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  PhCalendarBlank,
  PhChatCircleText,
  PhFile,
  PhRobot,
  PhSpinner,
  PhUser,
} from '@phosphor-icons/vue'
import { getSharedSnapshot, type SharedSnapshot } from '@/api/sharing'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import SourceCitations from '@/components/chat/SourceCitations.vue'

const route = useRoute()
const snapshot = ref<SharedSnapshot | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const messageCount = computed(() => snapshot.value?.messages.length ?? 0)

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
    return new Date(iso).toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fa-IR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}
</script>

<template>
  <div
    dir="rtl"
    class="flex min-h-dvh flex-col bg-bg text-ink"
  >
    <!-- Brand/header -->
    <header class="shrink-0 border-b border-line/70 bg-surface/80 backdrop-blur-xl">
      <div class="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent/70 text-white shadow-lg shadow-primary/15">
          <PhChatCircleText class="size-5" aria-hidden="true" />
        </div>

        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-medium tracking-wide text-ink-muted">گفتگوی اشتراک‌گذاری‌شده</p>
          <h1 class="truncate text-sm font-bold text-ink sm:text-base">
            {{ snapshot?.title?.trim() || 'گفتگوی بدون عنوان' }}
          </h1>
        </div>

        <span
          v-if="snapshot?.modelDisplayName"
          class="hidden shrink-0 items-center gap-1.5 rounded-full border border-line bg-elevated/70 px-3 py-1.5 text-xs text-ink-muted sm:inline-flex"
        >
          <PhRobot class="size-3.5 text-primary" aria-hidden="true" />
          {{ snapshot.modelDisplayName }}
        </span>
      </div>
    </header>

    <!-- Loading -->
    <main v-if="loading" class="flex flex-1 items-center justify-center px-4 py-16">
      <div class="flex flex-col items-center gap-4 text-center">
        <div class="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <PhSpinner class="size-7 animate-spin" aria-hidden="true" />
        </div>
        <p class="text-sm text-ink-muted">در حال بارگذاری گفتگو…</p>
      </div>
    </main>

    <!-- Error -->
    <main v-else-if="error" class="flex flex-1 items-center justify-center px-4 py-16">
      <div class="w-full max-w-md rounded-2xl border border-danger/30 bg-danger-soft px-6 py-8 text-center shadow-sm">
        <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <PhChatCircleText class="size-6" aria-hidden="true" />
        </div>
        <h2 class="mt-4 text-base font-bold text-ink">گفتگو در دسترس نیست</h2>
        <p class="mt-2 text-sm leading-6 text-ink-muted">{{ error }}</p>
      </div>
    </main>

    <!-- Shared transcript -->
    <main v-else-if="snapshot" class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
        <div class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line/70 bg-surface/60 px-4 py-3 text-xs text-ink-muted shadow-sm">
          <span class="inline-flex items-center gap-1.5">
            <PhChatCircleText class="size-3.5 text-primary" aria-hidden="true" />
            {{ messageCount }} پیام
          </span>
          <span class="hidden h-3 w-px bg-line sm:block" aria-hidden="true" />
          <span class="inline-flex items-center gap-1.5">
            <PhCalendarBlank class="size-3.5 text-accent" aria-hidden="true" />
            {{ formatDate(snapshot.createdAt) }}
          </span>
          <span
            v-if="snapshot.modelDisplayName"
            class="inline-flex items-center gap-1.5 sm:hidden"
          >
            <PhRobot class="size-3.5 text-primary" aria-hidden="true" />
            {{ snapshot.modelDisplayName }}
          </span>
        </div>

        <div
          v-if="snapshot.messages.length === 0"
          class="rounded-2xl border border-dashed border-line bg-surface/60 px-6 py-12 text-center text-sm text-ink-muted"
        >
          این گفتگو هنوز پیامی ندارد.
        </div>

        <div v-else class="space-y-7">
          <article
            v-for="(msg, idx) in snapshot.messages"
            :key="`${msg.createdAt}-${idx}`"
            class="flex items-start gap-3"
            :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
          >
            <div
              class="flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-sm"
              :class="msg.role === 'user'
                ? 'border-primary/20 bg-primary-soft text-primary'
                : 'border-accent/20 bg-accent/10 text-accent'"
            >
              <PhUser v-if="msg.role === 'user'" class="size-4" aria-hidden="true" />
              <PhRobot v-else class="size-4" aria-hidden="true" />
            </div>

            <div
              class="min-w-0"
              :class="msg.role === 'user' ? 'max-w-[88%] sm:max-w-[78%]' : 'max-w-full flex-1'"
            >
              <div
                class="mb-1.5 flex items-center gap-2 text-[11px] text-ink-muted"
                :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
              >
                <span class="font-medium text-ink-muted">
                  {{ msg.role === 'user' ? 'شما' : (snapshot.modelDisplayName || 'دستیار') }}
                </span>
                <span aria-hidden="true">·</span>
                <time :datetime="msg.createdAt">{{ formatTime(msg.createdAt) }}</time>
              </div>

              <div
                class="rounded-2xl border px-4 py-3.5 shadow-sm sm:px-5"
                :class="msg.role === 'user'
                  ? 'rounded-tr-sm border-primary/20 bg-primary-soft/70 text-ink'
                  : 'rounded-tl-sm border-line bg-surface text-ink'"
              >
                <MarkdownRenderer
                  v-if="msg.role === 'assistant'"
                  :source="msg.content"
                />
                <div
                  v-else
                  class="whitespace-pre-wrap text-sm leading-7"
                  dir="auto"
                >
                  {{ msg.content }}
                </div>

                <ReasoningPanel
                  v-if="msg.role === 'assistant' && msg.reasoningSummary"
                  :summary="msg.reasoningSummary"
                />

                <SourceCitations
                  v-if="msg.role === 'assistant' && msg.citations.length"
                  :sources="msg.citations"
                />

                <div
                  v-if="msg.file"
                  class="mt-3 inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-elevated/60 px-2.5 py-1.5 text-xs text-ink-muted"
                >
                  <PhFile class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span class="truncate">{{ msg.file.originalName }}</span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </main>

    <footer class="shrink-0 border-t border-line/70 bg-surface/50 px-4 py-3 text-center text-xs text-ink-muted/70">
      این گفتگو از طریق یک لینک اشتراک‌گذاری‌شده به شما نمایش داده می‌شود.
    </footer>
  </div>
</template>
