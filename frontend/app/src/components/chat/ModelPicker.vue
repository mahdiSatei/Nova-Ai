<script setup lang="ts">
// انتخاب‌گر مدل: پشتیبانی از حالت inline با Modal زیبای و حالت فرم عادی
import { computed, ref, watch } from 'vue'
import { PhSparkle, PhCaretDown } from '@phosphor-icons/vue'
import { useModelsStore } from '@/stores/models'
import EmptyState from '@/components/ui/EmptyState.vue'
import ModelSelectorModal from './ModelSelectorModal.vue'

const props = withDefaults(
  defineProps<{ modelValue: string | null; disabled?: boolean; inline?: boolean }>(),
  { disabled: false, inline: false },
)
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const models = useModelsStore()
const modalOpen = ref(false)

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

    if (resolved) updateModel(resolved)
  },
  { immediate: true },
)

const currentModel = computed(() => {
  return models.items.find((m) => m.id === props.modelValue) ?? models.items[0] ?? null
})

function updateModel(id: string) {
  emit('update:modelValue', id)
  try {
    sessionStorage.setItem('mmcb.lastModelId', id)
  } catch {
    /* ignore */
  }
}

function onChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value || null
  if (value) updateModel(value)
}
</script>

<template>
  <div class="relative inline-flex items-center">
    <!-- حالت inline: دکمه هدر که با کلیک، Modal باز می‌کند -->
    <div v-if="inline">
      <button
        type="button"
        :disabled="disabled || models.loading || models.isEmpty"
        class="group flex cursor-pointer items-center gap-2 rounded-xl border border-line/70 bg-surface/80 px-3 py-1.5 text-xs font-semibold text-ink shadow-sm transition-all hover:border-primary/40 hover:bg-primary-soft/40 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
        @click="modalOpen = true"
      >
        <span class="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
          <PhSparkle class="size-3" aria-hidden="true" />
        </span>
        <span class="flex min-w-0 flex-col items-start leading-tight">
          <span class="max-w-[140px] truncate">
            {{ currentModel ? currentModel.displayName : 'انتخاب مدل' }}
          </span>
          <span v-if="currentModel?.isDefault" class="text-[9px] font-medium text-primary/80">مدل پیش‌فرض</span>
        </span>
        <PhCaretDown
          class="size-3 text-ink-muted transition-transform group-hover:text-ink"
          aria-hidden="true"
        />
      </button>

      <!-- پاپ‌آپ انتخاب مدل -->
      <ModelSelectorModal
        :open="modalOpen"
        :model-value="modelValue"
        @update:open="modalOpen = $event"
        @select="updateModel"
      />
    </div>

    <!-- حالت عادی فرم -->
    <div v-else class="flex w-full flex-col gap-2">
      <label class="text-xs font-medium text-ink-muted">انتخاب مدل هوش مصنوعی</label>

      <div
        v-if="models.loading && models.items.length === 0"
        class="h-10 animate-pulse rounded-xl bg-elevated"
      />

      <div
        v-else-if="models.isEmpty"
        class="rounded-xl border border-dashed border-line bg-surface px-3 py-3"
      >
        <EmptyState
          title="چت هنوز پیکربندی نشده است"
          description="مدیر سیستم هنوز هیچ مدل فعالی اضافه نکرده است."
        >
          <template #icon>
            <PhSparkle class="size-7 text-primary" aria-hidden="true" />
          </template>
        </EmptyState>
      </div>

      <div v-else class="relative">
        <div class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-primary">
          <PhSparkle class="size-4" aria-hidden="true" />
        </div>

        <select
          :value="modelValue ?? ''"
          :disabled="disabled || models.loading"
          class="w-full cursor-pointer appearance-none rounded-xl border border-line bg-surface py-2.5 pe-9 ps-9 text-sm text-ink transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          @change="onChange"
        >
          <option
            v-for="m in models.items"
            :key="m.id"
            :value="m.id"
            class="bg-surface text-ink"
          >
            {{ m.displayName }}{{ m.isDefault ? ' ★ (پیش‌فرض)' : '' }}
          </option>
        </select>

        <PhCaretDown
          class="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
      </div>
    </div>
  </div>
</template>