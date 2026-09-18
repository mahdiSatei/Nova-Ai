<script setup lang="ts">
// انتخاب‌گر مدل. دو حالت:
// - عادی: label بالای select (مثلاً برای فرم)
// - inline: فقط select افقی (برای هدر چت)
// در حالت بدون مدل فعال، BR-014 پیام خالی بودن را نمایش می‌دهد.
import { computed, watch } from 'vue'
import { PhSparkle, PhCaretDown } from '@phosphor-icons/vue'
import { useModelsStore } from '@/stores/models'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = withDefaults(
  defineProps<{ modelValue: string | null; disabled?: boolean; inline?: boolean }>(),
  { disabled: false, inline: false },
)
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const models = useModelsStore()

watch(
  () => models.items,
  (items) => {
    // Re-resolve whenever the current value is not in the (entitlement-filtered)
    // catalog — e.g. an admin restricted the model after this client loaded it,
    // or the user's own access changed. Never leave an inaccessible model
    // selected. (فاز ۳: انتخاب‌گر مدل نباید مدل غیرمجاز را نشان دهد.)
    const current = props.modelValue
    if (current && items.some((m) => m.id === current)) return
    const last = (() => {
      try {
        return sessionStorage.getItem('mmcb.lastModelId')
      } catch {
        return null
      }
    })()
    const explicitId = items.find((m) => m.id === last)?.id
    const defaultId = items.find((m) => m.isDefault)?.id
    const fallbackId = items[0]?.id ?? null
    const resolved = explicitId ?? defaultId ?? fallbackId
    if (resolved !== current) emit('update:modelValue', resolved)
  },
  { immediate: true },
)

const items = computed(() => models.items)

function onChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value || null
  emit('update:modelValue', value)
}
</script>

<template>
  <!-- حالت inline: فقط یک select کوچک بدون label -->
  <div v-if="inline" class="flex items-center gap-1.5">
    <select
      :value="modelValue ?? ''"
      :disabled="disabled || models.loading || models.isEmpty"
      :aria-label="'انتخاب مدل'"
      class="cursor-pointer appearance-none border-0 bg-transparent pe-5 ps-0 text-xs font-medium text-ink transition-colors focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      @change="onChange"
    >
      <option v-for="m in items" :key="m.id" :value="m.id">
        {{ m.displayName }}{{ m.isDefault ? ' ★' : '' }}
      </option>
    </select>
    <PhCaretDown class="pointer-events-none size-3 text-ink-muted" aria-hidden="true" />
  </div>

  <!-- حالت عادی -->
  <div v-else class="flex flex-col gap-2">
    <label class="text-xs font-medium text-ink-muted">مدل</label>

    <div v-if="models.loading && models.items.length === 0" class="h-10 animate-pulse rounded-lg bg-elevated" />

    <div
      v-else-if="models.isEmpty"
      class="rounded-lg border border-dashed border-line bg-surface px-3 py-3"
    >
      <EmptyState
        title="چت هنوز پیکربندی نشده است"
        description="هیچ مدلی برای حساب شما در دسترس نیست."
      >
        <template #icon>
          <PhSparkle class="size-7 text-primary" aria-hidden="true" />
        </template>
      </EmptyState>
    </div>

    <div v-else class="relative">
      <select
        :value="modelValue ?? ''"
        :disabled="disabled || models.loading"
        class="w-full appearance-none rounded-lg border border-line bg-surface px-3 py-2.5 pe-9 text-sm text-ink transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        @change="onChange"
      >
        <option v-for="m in items" :key="m.id" :value="m.id">
          {{ m.displayName }}{{ m.isDefault ? ' ★' : '' }}
        </option>
      </select>
      <PhCaretDown
        class="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
    </div>
  </div>
</template>
