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
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        @click.self="close"
      >
        <transition
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="scale-90 opacity-0 translate-y-4"
          enter-to-class="scale-100 opacity-100 translate-y-0"
          leave-active-class="transition duration-200 ease-in"
          leave-from-class="scale-100 opacity-100 translate-y-0"
          leave-to-class="scale-95 opacity-0 translate-y-2"
        >
          <div
            v-if="open"
            class="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-2xl"
            dir="rtl"
            @click.stop
          >
            <div class="flex items-center justify-between px-5 pt-5 pb-3">
              <div class="flex items-center gap-3">
                <span class="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent/70 text-on-primary shadow-md">
                  <PhSparkle class="size-4.5" />
                </span>
                <div>
                  <h3 class="text-sm font-bold text-ink">انتخاب مدل</h3>
                   <p class="text-[11px] text-ink-muted/80">{{ models.items.length }} مدل در دسترس</p>
                </div>
              </div>
              <button
                type="button"
                class="flex size-8 items-center justify-center rounded-lg text-ink-muted/60 transition-all hover:bg-hover hover:text-ink cursor-pointer"
                @click="close"
              >
                <PhX class="size-4" />
              </button>
            </div>

            <div class="max-h-[50vh] overflow-y-auto overscroll-contain px-3 pb-3">
              <div class="space-y-1.5">
                <button
                  v-for="m in models.items"
                  :key="m.id"
                  type="button"
                  class="group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition-all duration-150 cursor-pointer"
                  :class="
                    m.id === modelValue
                      ? 'bg-primary/10 ring-1 ring-primary/30'
                      : 'hover:bg-elevated/80 active:scale-[0.99]'
                  "
                  @click="select(m.id)"
                >
                  <div
                    class="flex size-10 shrink-0 items-center justify-center rounded-lg transition-all duration-200"
                    :class="
                      m.id === modelValue
                        ? 'bg-primary text-on-primary shadow-md shadow-primary/25 scale-105'
                        : 'bg-elevated text-primary/70 border border-line/50 group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/30'
                    "
                  >
                    <PhSparkle class="size-4" />
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="truncate text-sm font-semibold text-ink">{{ m.displayName }}</span>
                      <span
                        v-if="m.isDefault"
                        class="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-primary uppercase"
                      >
                        <PhShieldCheck class="size-2.5" />
                        default
                      </span>
                    </div>
                    <span class="mt-0.5 block truncate font-mono text-[11px] text-ink-muted/60">{{ m.actualName }}</span>
                  </div>

                  <div
                    class="flex size-5 shrink-0 items-center justify-center rounded-full transition-all duration-200"
                    :class="
                      m.id === modelValue
                        ? 'bg-primary text-on-primary shadow-xs scale-100'
                        : 'border-2 border-line/40 bg-transparent scale-90 opacity-0 group-hover:opacity-100'
                    "
                  >
                    <PhCheck v-if="m.id === modelValue" class="size-3 stroke-[3]" />
                  </div>
                </button>
              </div>

              <div v-if="models.items.length === 0" class="flex flex-col items-center justify-center py-10 text-center">
                <PhSparkle class="size-8 text-ink-muted/30 mb-2" />
                <p class="text-sm font-medium text-ink-muted/60">مدلی یافت نشد</p>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </teleport>
</template>