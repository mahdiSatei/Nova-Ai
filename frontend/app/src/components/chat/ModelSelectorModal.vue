<script setup lang="ts">
import { PhX, PhSparkle, PhCheck, PhShieldCheck } from '@phosphor-icons/vue'
import { useModelsStore } from '@/stores/models'

const props = defineProps<{
  open: boolean
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'select': [id: string]
}>()

const models = useModelsStore()

function close() {
  emit('update:open', false)
}

function select(id: string) {
  emit('select', id)
  close()
}
</script>

<template>
  <teleport to="body">
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        @click.self="close"
      >
        <transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="scale-95 opacity-0"
          enter-to-class="scale-100 opacity-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="scale-100 opacity-100"
          leave-to-class="scale-95 opacity-0"
        >
          <div
            v-if="open"
            class="relative w-full max-w-md overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-2xl"
            dir="rtl"
          >
            <!-- هدر مودال -->
            <div class="flex items-center justify-between pb-4 border-b border-line">
              <div class="flex items-center gap-3">
                <span class="flex size-10 items-center justify-center rounded-2xl bg-primary-soft text-primary shadow-2xs">
                  <PhSparkle class="size-5" />
                </span>
                <div class="text-start">
                  <h3 class="text-base font-bold text-ink">انتخاب مدل هوش مصنوعی</h3>
                  <p class="text-xs text-ink-muted">مدل مناسب برای گفتگوی خود را انتخاب کنید.</p>
                </div>
              </div>
              <button
                type="button"
                class="flex size-8 items-center justify-center rounded-xl text-ink-muted hover:bg-hover hover:text-ink transition cursor-pointer"
                @click="close"
              >
                <PhX class="size-4" />
              </button>
            </div>

            <!-- لیست کارت‌های مدل -->
            <div class="mt-4 max-h-[60vh] space-y-2.5 overflow-y-auto py-1">
              <button
                v-for="m in models.items"
                :key="m.id"
                type="button"
                class="group relative flex w-full items-center justify-between rounded-2xl border p-4 text-start transition-all cursor-pointer"
                :class="
                  m.id === modelValue
                    ? 'border-primary bg-primary-soft/40 shadow-xs ring-1 ring-primary/30'
                    : 'border-line/80 bg-elevated/30 hover:border-primary/40 hover:bg-hover'
                "
                @click="select(m.id)"
              >
                <div class="flex items-center gap-3.5 min-w-0">
                  <div
                    class="flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors shadow-2xs"
                    :class="m.id === modelValue ? 'bg-primary text-on-primary' : 'bg-surface text-primary border border-line group-hover:bg-primary group-hover:text-on-primary'"
                  >
                    <PhSparkle class="size-5" />
                  </div>
                  <div class="min-w-0 text-start">
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-sm text-ink truncate">{{ m.displayName }}</span>
                      <span v-if="m.isDefault" class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <PhShieldCheck class="size-3" />
                        پیش‌فرض
                      </span>
                    </div>
                    <span class="block mt-0.5 font-mono text-xs text-ink-muted truncate">{{ m.actualName }}</span>
                  </div>
                </div>

                <!-- تیک انتخاب -->
                <div
                  class="flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors shadow-2xs"
                  :class="m.id === modelValue ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface'"
                >
                  <PhCheck v-if="m.id === modelValue" class="size-3.5 stroke-[2.5]" />
                </div>
              </button>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </teleport>
</template>