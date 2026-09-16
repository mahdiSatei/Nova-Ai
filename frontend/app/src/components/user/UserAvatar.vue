<script setup lang="ts">
// آواتار هویتی (identicon) تولیدشده از یک مقدار پایدار (id کاربر).
// همان مقدار همیشه همان آیکون را می‌سازد؛ بدون آپلود یا ذخیره تصویر.
import { onMounted, ref, watch } from 'vue'
import { update as jdenticonUpdate } from 'jdenticon'

const props = defineProps<{
  /** مقدار هش (معمولاً user.id) */
  value: string
  /** اندازه مربع به px */
  size?: number
}>()

const svgEl = ref<SVGElement | null>(null)

function render(): void {
  if (svgEl.value) {
    jdenticonUpdate(svgEl.value, props.value)
  }
}

onMounted(render)
watch(() => props.value, render)
</script>

<template>
  <svg
    ref="svgEl"
    :width="size ?? 32"
    :height="size ?? 32"
    aria-hidden="true"
  />
</template>
