<script setup lang="ts">
// Modal تأیید با استفاده از <dialog> بومی (focus trap و Esc داخلی).
// طبق §5.3: اقدامات مخرب نیاز به تأیید صریح دارند (حذف گفتگو، حذف مدل، پاک کردن پیش‌فرض).
import { onMounted, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { PhWarningCircle } from '@phosphor-icons/vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    variant?: 'primary' | 'danger'
    busy?: boolean
  }>(),
  { confirmLabel: 'تأیید', cancelLabel: 'انصراف', variant: 'danger', busy: false },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

const dialog = ref<HTMLDialogElement | null>(null)

function close(): void {
  emit('update:open', false)
}

function onConfirm(): void {
  emit('confirm')
}

function onCancel(): void {
  if (props.busy) return
  close()
}

watch(
  () => props.open,
  (isOpen) => {
    const el = dialog.value
    if (!el) return
    if (isOpen && !el.open) el.showModal()
    if (!isOpen && el.open) el.close()
  },
)

onMounted(() => {
  if (props.open) dialog.value?.showModal()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="mx-auto my-auto rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-bg/70"
    @close="emit('update:open', false)"
    @cancel.prevent="onCancel"
  >
    <div class="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-4 p-6">
      <header class="flex items-start gap-3">
        <PhWarningCircle class="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
        <div class="min-w-0">
          <h2 class="text-base font-semibold">{{ title }}</h2>
          <p v-if="description" class="mt-1 text-sm text-ink-muted">{{ description }}</p>
        </div>
      </header>
      <footer class="flex items-center justify-end gap-2">
        <BaseButton variant="ghost" size="sm" :disabled="busy" @click="onCancel">
          {{ cancelLabel }}
        </BaseButton>
        <BaseButton :variant="variant" size="sm" :loading="busy" @click="onConfirm">
          {{ confirmLabel }}
        </BaseButton>
      </footer>
    </div>
  </dialog>
</template>
