<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-6 py-12 text-center">
    <slot name="icon">
      <div class="size-10 rounded-full bg-elevated" aria-hidden="true" />
    </slot>
    <p class="font-medium text-ink">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-sm text-ink-muted">{{ description }}</p>
    <div class="mt-2"><slot /></div>
  </div>
</template>
