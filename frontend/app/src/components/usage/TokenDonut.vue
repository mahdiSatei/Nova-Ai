<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}>()

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const segments = computed(() => {
  const parts = [
    { label: 'ورودی', value: Math.max(0, props.inputTokens), color: 'stroke-primary' },
    { label: 'خروجی', value: Math.max(0, props.outputTokens), color: 'stroke-accent' },
    { label: 'استدلال', value: Math.max(0, props.reasoningTokens), color: 'stroke-warning' },
  ]
  const total = parts.reduce((sum, p) => sum + p.value, 0)
  let start = 0
  return parts
    .filter((p) => p.value > 0 && total > 0)
    .map((p) => {
      const fraction = p.value / total
      const arc = { ...p, percent: Math.round(fraction * 100), offset: -start * CIRCUMFERENCE, dash: fraction * CIRCUMFERENCE }
      start += fraction
      return arc
    })
})

function format(value: number): string {
  return Number(value || 0).toLocaleString('fa-IR')
}
</script>

<template>
  <div class="flex items-center gap-5">
    <svg viewBox="0 0 100 100" class="size-32 shrink-0 -rotate-90" role="img" aria-label="ترکیب مصرف توکن">
      <circle cx="50" cy="50" :r="RADIUS" fill="none" stroke-width="12" class="stroke-line" />
      <circle
        v-for="seg in segments"
        :key="seg.label"
        cx="50"
        cy="50"
        :r="RADIUS"
        fill="none"
        stroke-width="12"
        class="donut-arc transition-all duration-700 ease-out"
        :class="seg.color"
        :stroke-dasharray="`${seg.dash} ${CIRCUMFERENCE}`"
        :stroke-dashoffset="seg.offset"
      />
    </svg>

    <div class="flex-1 space-y-3">
      <div v-for="seg in segments" :key="seg.label" class="flex items-center justify-between text-xs">
        <span class="flex items-center gap-1.5 text-ink-muted">
          <span class="size-2.5 rounded-full" :class="{ 'bg-primary': seg.color === 'stroke-primary', 'bg-accent': seg.color === 'stroke-accent', 'bg-warning': seg.color === 'stroke-warning' }" />
          {{ seg.label }} · {{ format(seg.value) }}
        </span>
        <strong class="text-ink">{{ format(seg.percent) }}٪</strong>
      </div>
      <p v-if="segments.length === 0" class="text-xs text-ink-muted">هنوز توکنی مصرف نشده است.</p>
      <p class="border-t border-line/70 pt-3 text-xs text-ink-muted">
        کل توکن‌ها: <strong class="text-ink">{{ format(props.totalTokens) }}</strong>
      </p>
    </div>
  </div>
</template>
