<script setup lang="ts">
import { PhWarningCircle, PhX } from '@phosphor-icons/vue'

defineProps<{
  message: string
}>()

defineEmits<{
  close: []
}>()
</script>

<template>
  <Transition
    appear
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="-translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-3 opacity-0"
  >
    <div
      role="alert"
      aria-live="assertive"
      class="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border border-danger/40 bg-surface/95 px-4 py-3 text-danger shadow-xl backdrop-blur-md"
    >
      <PhWarningCircle class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <p class="min-w-0 flex-1 text-sm leading-6 text-ink">{{ message }}</p>
      <button
        type="button"
        class="-me-1 -mt-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        aria-label="بستن اعلان خطا"
        @click="$emit('close')"
      >
        <PhX class="size-4" aria-hidden="true" />
      </button>
    </div>
  </Transition>
</template>
