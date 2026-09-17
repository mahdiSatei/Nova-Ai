<script setup lang="ts">
// ورودی شناور پایین صفحه: textarea خوداِندازه، Enter ارسال / Shift+Enter خط جدید.
// دکمه هنگام استریم به «توقف» تبدیل می‌شود (رویداد stop). منطق ارسال دست ChatView است.
import { computed, nextTick, ref, watch } from 'vue'
import { PhArrowUp, PhStop } from '@phosphor-icons/vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    disabled?: boolean
    busy?: boolean
  }>(),
  { placeholder: 'پیام خود را بنویسید…', disabled: false, busy: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  stop: []
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(
  () => !props.disabled && !props.busy && props.modelValue.trim().length > 0,
)

function autoResize(): void {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`
}

watch(() => props.modelValue, () => nextTick(autoResize), { immediate: true })

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (canSend.value) emit('submit')
  }
}

function onSubmitClick(): void {
  if (props.busy) {
    emit('stop')
    return
  }
  if (canSend.value) emit('submit')
}
</script>

<template>
  <form @submit.prevent="onSubmitClick">
    <div
      class="flex items-end gap-2 rounded-[1.4rem] border bg-surface p-2 shadow-lg transition-[border-color,box-shadow] duration-200"
      :class="[
        disabled || busy
          ? 'border-line/70 shadow-(--app-shadow)'
          : 'border-line focus-within:border-primary/60 focus-within:shadow-(--app-shadow) focus-within:shadow-xl',
      ]"
    >
      <textarea
        ref="textarea"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        rows="1"
        dir="rtl"
        class="max-h-56 min-h-9 flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-sm leading-6 text-ink placeholder:text-ink-muted/60 focus:outline-none disabled:cursor-not-allowed"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="submit"
        :disabled="!busy && !canSend"
        :aria-label="busy ? 'توقف تولید پاسخ' : 'ارسال پیام'"
        class="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all duration-150 disabled:cursor-not-allowed"
        :class="[
          busy
            ? 'bg-ink text-bg hover:opacity-80'
            : canSend
              ? 'bg-primary text-on-primary shadow-sm hover:bg-primary-hover'
              : 'bg-elevated text-ink-muted/60',
        ]"
      >
        <PhStop v-if="busy" class="size-4 fill-current" aria-hidden="true" />
        <PhArrowUp v-else class="size-[18px] font-bold" aria-hidden="true" weight="bold" />
      </button>
    </div>
    <p class="mt-2 hidden text-center text-[11px] text-ink-muted/60 sm:block">
      Enter ارسال · Shift+Enter خط جدید
    </p>
  </form>
</template>
