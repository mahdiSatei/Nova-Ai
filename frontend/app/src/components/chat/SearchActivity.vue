<script setup lang="ts">
// وضعیت جستجو/بازیابی حین تولید پاسخ.
import { computed } from 'vue'
import {
  PhMagnifyingGlass,
  PhDownloadSimple,
  PhSparkle,
  PhWarningCircle,
} from '@phosphor-icons/vue'
import type { SearchPhase } from '@/types/api'

const props = defineProps<{
  activity: { phase: SearchPhase; query?: string; sources?: number; credits?: number }
}>()

const label = computed(() => {
  const q = props.activity.query ? `«${props.activity.query}»` : ''
  switch (props.activity.phase) {
    case 'search_started':
      return `در حال جستجوی وب ${q}…`
    case 'search_completed':
      return props.activity.sources
        ? `${props.activity.sources} نتیجه پیدا شد${q ? ` برای ${q}` : ''}…`
        : `نتیجه‌ای برای ${q} پیدا نشد…`
    case 'retrieval_started':
      return 'در حال خواندن محتوای منابع…'
    case 'retrieval_completed':
      return 'محتوای منابع آماده شد؛ در حال نوشتن پاسخ…'
    default:
      return 'در حال نوشتن پاسخ…'
  }
})
</script>

<template>
  <p
    class="mt-1 flex items-center gap-1.5 px-1 text-xs text-ink-muted"
    role="status"
    aria-live="polite"
  >
    <PhWarningCircle
      v-if="activity.phase === 'search_completed' && !activity.sources"
      class="size-3.5 text-warning"
      aria-hidden="true"
    />
    <PhMagnifyingGlass
      v-else-if="activity.phase === 'search_started'"
      class="size-3.5 animate-pulse"
      aria-hidden="true"
    />
    <PhDownloadSimple
      v-else-if="activity.phase === 'retrieval_started'"
      class="size-3.5 animate-pulse"
      aria-hidden="true"
    />
    <PhSparkle v-else class="size-3.5 animate-pulse" aria-hidden="true" />
    <span>{{ label }}</span>
  </p>
</template>
