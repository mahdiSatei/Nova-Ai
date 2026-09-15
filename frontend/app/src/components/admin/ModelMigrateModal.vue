<script setup lang="ts">
// دیالوگ «مهاجرت و حذف مدل»: وقتی حذف مدل با 409 model_in_use رد می‌شود باز می‌شود.
// یک مدل جایگزین فعال انتخاب می‌کند؛ سرور ابتدا همه ارجاع‌ها (گفتگوها، انتخاب
// کاربران، مدل پیش‌فرض) به آن منتقل می‌کند، صفرشدن ارجاع‌ها را بررسی می‌کند و
// سپس مدل قدیمی را حذف می‌کند. هیچ داده‌ای Force Delete نمی‌شود.
import { computed, ref, watch } from 'vue'
import { PhArrowSquareOut, PhWarningCircle } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import type { ModelAdmin } from '@/types/api'

const props = defineProps<{
  open: boolean
  target: ModelAdmin | null
  candidates: ModelAdmin[]
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [replacementId: string]
}>()

const selected = ref('')
const canConfirm = computed(() => !props.busy && !!selected.value && !!props.target)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) selected.value = props.candidates[0]?.id ?? ''
  },
)

function close(): void {
  if (props.busy) return
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open && target"
        class="fixed inset-0 z-30 flex items-center justify-center bg-bg/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="مهاجرت و حذف مدل"
        @click.self="close"
      >
        <div class="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-xl">
          <header class="mb-1 flex items-start gap-3">
            <PhWarningCircle class="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            <div class="min-w-0">
              <h2 class="text-lg font-semibold">انتقال به مدل جایگزین و حذف</h2>
              <p class="mt-1 text-sm text-ink-muted">
                مدل «<span class="font-medium text-ink" dir="ltr">{{ target.displayName }}</span>»
                هنوز در حال استفاده است. با انتخاب یک مدل جایگزین فعال، همه‌ی گفتگوها،
                انتخاب‌های کاربران و (در صورت نیاز) مدل پیش‌فرض سیستم به‌صورت امن و در یک
                مرحله به آن منتقل می‌شوند؛ پس از تأییدِ صفرشدن ارجاع‌ها، مدل قدیمی حذف
                می‌شود. تاریخچه گفتگوها حذف نمی‌شود.
              </p>
            </div>
          </header>

          <div v-if="candidates.length === 0" class="mt-4">
            <ErrorBanner
              message="هیچ مدل فعال جایگزینی وجود ندارد. ابتدا یک مدل فعال بسازید یا یکی را فعال کنید، سپس دوباره تلاش کنید."
            />
          </div>

          <fieldset v-else class="mt-4 flex flex-col gap-1.5" :disabled="busy">
            <legend class="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted/70">
              مدل جایگزین
            </legend>
            <label
              v-for="c in candidates"
              :key="c.id"
              class="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-elevated/40 px-3 py-2.5 text-sm transition-colors hover:border-primary/40"
              :class="{ 'border-primary/60 bg-primary-soft': selected === c.id }"
            >
              <input
                v-model="selected"
                type="radio"
                name="replacement-model"
                :value="c.id"
                class="size-4 cursor-pointer accent-primary"
              />
              <span class="min-w-0 flex-1 truncate text-ink" dir="ltr">{{ c.displayName }}</span>
              <span
                v-if="c.isDefault"
                class="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary"
              >
                <PhArrowSquareOut class="size-3" aria-hidden="true" />
                پیش‌فرض فعلی
              </span>
            </label>
          </fieldset>

          <footer class="mt-5 flex items-center justify-end gap-2">
            <BaseButton variant="ghost" size="sm" :disabled="busy" @click="close">انصراف</BaseButton>
            <BaseButton
              variant="danger"
              size="sm"
              :loading="busy"
              :disabled="!canConfirm"
              @click="emit('confirm', selected)"
            >
              انتقال و حذف مدل
            </BaseButton>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 150ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
