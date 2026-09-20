<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhX, PhSparkle, PhCheck, PhShieldCheck, PhMagnifyingGlass, PhBrain, PhGlobeHemisphereWest } from '@phosphor-icons/vue'
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
const search = ref('')

const filteredModels = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  if (!query) return models.items
  return models.items.filter((model) =>
    [model.displayName, model.providerName ?? '']
      .join(' ')
      .toLocaleLowerCase()
      .includes(query),
  )
})

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
            class="relative flex w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-line/70 bg-surface shadow-2xl shadow-black/20"
            dir="rtl"
            @click.stop
          >
            <div class="border-b border-line/70 bg-gradient-to-br from-primary-soft/70 via-surface to-accent/5 px-5 pb-4 pt-5">
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-center gap-3">
                  <span class="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent/70 text-on-primary shadow-lg shadow-primary/20">
                    <PhSparkle class="size-5" />
                  </span>
                  <div>
                    <h3 class="text-base font-bold text-ink">انتخاب مدل</h3>
                    <p class="mt-0.5 text-[11px] text-ink-muted/80">{{ models.items.length }} مدل برای گفتگو در دسترس است</p>
                  </div>
                </div>
                <button
                  type="button"
                  class="flex size-8 cursor-pointer items-center justify-center rounded-xl text-ink-muted/60 transition-all hover:bg-hover hover:text-ink"
                  aria-label="بستن انتخاب مدل"
                  @click="close"
                >
                  <PhX class="size-4" />
                </button>
              </div>

              <label class="relative mt-4 block">
                <PhMagnifyingGlass class="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                <input
                  v-model="search"
                  type="search"
                  placeholder="جستجو بین مدل‌ها…"
                  class="w-full rounded-xl border border-line/70 bg-surface/80 py-2.5 pe-3 ps-10 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                />
              </label>
            </div>

            <div class="max-h-[55vh] overflow-y-auto overscroll-contain px-3 py-3">
              <div class="space-y-1.5">
                <button
                  v-for="m in filteredModels"
                  :key="m.id"
                  type="button"
                  class="group relative flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-start transition-all duration-150"
                  :class="
                    m.id === modelValue
                      ? 'bg-primary/10 ring-1 ring-primary/30'
                      : 'hover:border-line/70 hover:bg-elevated/70 active:scale-[0.99]'
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
                    <div class="flex min-w-0 items-center gap-1.5">
                      <span class="truncate text-sm font-semibold text-ink">{{ m.displayName }}</span>
                      <span
                        v-if="m.isDefault"
                        class="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary"
                      >
                        <PhShieldCheck class="size-2.5" />
                        پیش‌فرض
                      </span>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-muted/70">
                      <span v-if="m.providerName" class="inline-flex items-center gap-1 font-medium text-ink-muted">
                        {{ m.providerName }}
                      </span>
                      <span v-if="m.reasoning?.supported" class="inline-flex items-center gap-1">
                        <PhBrain class="size-3 text-primary" aria-hidden="true" />
                        استدلال
                      </span>
                      <span v-if="m.reasoning?.supported && m.reasoning?.streaming" class="inline-flex items-center gap-1">
                        <PhGlobeHemisphereWest class="size-3 text-accent" aria-hidden="true" />
                        پاسخ زنده
                      </span>
                    </div>
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

              <div v-if="filteredModels.length === 0" class="flex flex-col items-center justify-center px-4 py-12 text-center">
                <span class="flex size-12 items-center justify-center rounded-2xl bg-elevated text-ink-muted/50">
                  <PhMagnifyingGlass class="size-5" />
                </span>
                <p class="mt-3 text-sm font-medium text-ink-muted">مدلی با این عبارت پیدا نشد</p>
                <button
                  v-if="search"
                  type="button"
                  class="mt-2 cursor-pointer text-xs text-primary hover:underline"
                  @click="search = ''"
                >
                  پاک کردن جستجو
                </button>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </teleport>
</template>