<script setup lang="ts">
// فاز ۸ — پنل خلاصهٔ استدلال. فقط محتوایی که ارائه‌دهنده برای کاربر نمایش داده
// است اینجا می‌آید؛ زنجیرهٔ فکر خصوصی هرگز نمایش داده نمی‌شود.
import { computed, ref, watch } from 'vue'
import { PhBrain, PhCaretDown } from '@phosphor-icons/vue'

const props = withDefaults(defineProps<{ summary: string; streaming?: boolean }>(), {
  streaming: false,
})

const expanded = ref(props.streaming)

watch(
  () => props.streaming,
  (streaming) => {
    // While reasoning streams the panel is open; when the answer starts it
    // collapses so the answer becomes the focus.
    expanded.value = streaming
  },
)

const preview = computed(() =>
  props.summary.length > 90 ? `${props.summary.slice(0, 90)}…` : props.summary,
)
</script>

<template>
  <div class="mt-2 rounded-lg border border-line bg-elevated/40" data-testid="reasoning-panel">
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-xs text-ink-muted transition-colors hover:text-ink"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <PhBrain class="size-3.5 text-primary" aria-hidden="true" />
      <span class="font-medium">{{ streaming ? 'در حال استدلال…' : 'خلاصه استدلال' }}</span>
      <span v-if="!expanded" class="min-w-0 flex-1 truncate text-start text-ink-muted/70">{{ preview }}</span>
      <PhCaretDown
        class="ms-auto size-3 shrink-0 transition-transform"
        :class="{ 'rotate-180': expanded }"
        aria-hidden="true"
      />
    </button>
    <div
      v-if="expanded"
      class="whitespace-pre-wrap px-3 pb-3 text-xs leading-6 text-ink-muted"
      role="note"
    >
      {{ summary }}
    </div>
  </div>
</template>
