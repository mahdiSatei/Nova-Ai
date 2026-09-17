<script setup lang="ts">
// بخش تاشوی عمودی با هدر کلیک‌پذیر؛ وضعیت باز/بسته در localStorage می‌ماند.
import { ref } from 'vue'
import { PhCaretDown } from '@phosphor-icons/vue'

const props = defineProps<{ title: string; storageKey: string }>()

function initialOpen(): boolean {
  try {
    return localStorage.getItem(props.storageKey) !== 'closed'
  } catch {
    return true
  }
}

const open = ref(initialOpen())

function toggle(): void {
  open.value = !open.value
  try {
    localStorage.setItem(props.storageKey, open.value ? 'open' : 'closed')
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted/70 transition-colors hover:text-ink"
      :aria-expanded="open"
      @click="toggle"
    >
      <PhCaretDown
        class="size-3 shrink-0 transition-transform duration-200"
        :class="open ? '' : '-rotate-90'"
        aria-hidden="true"
      />
      <span>{{ title }}</span>
    </button>
    <div v-show="open" class="flex flex-col gap-0.5 pt-0.5">
      <slot />
    </div>
  </div>
</template>
