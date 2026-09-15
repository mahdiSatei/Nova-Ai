<script setup lang="ts">
// سه نقطه‌ی پران — در فاصله‌ی بین ارسال پیام و اولین توکن استریم.
withDefaults(defineProps<{ label?: string }>(), { label: 'در حال نوشتن…' })
</script>

<template>
  <div class="flex items-center gap-2 py-1" role="status" :aria-label="label">
    <span class="flex items-end gap-1" aria-hidden="true">
      <i class="size-1.5 animate-typing-bounce rounded-full bg-primary [animation-delay:0ms]" />
      <i class="size-1.5 animate-typing-bounce rounded-full bg-primary [animation-delay:150ms]" />
      <i class="size-1.5 animate-typing-bounce rounded-full bg-primary [animation-delay:300ms]" />
    </span>
    <span class="text-xs text-ink-muted">{{ label }}</span>
  </div>
</template>
