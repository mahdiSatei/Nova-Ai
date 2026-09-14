<script setup lang="ts">
// ورودی پیام با طراحی AI-Native: textarea چسبیده به پایین با دکمه ارسال.
// auto-resize، Enter برای ارسال، Shift+Enter خط جدید، غیرفعال در حالت streaming/noModels.
import { nextTick, ref, watch } from 'vue'
import { PhPaperPlaneTilt } from '@phosphor-icons/vue'

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
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)

function autoResize(): void {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

watch(() => props.modelValue, () => nextTick(autoResize), { immediate: true })

function onInput(e: Event): void {
  const value = (e.target as HTMLTextAreaElement).value
  emit('update:modelValue', value)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (!props.disabled && !props.busy && props.modelValue.trim()) emit('submit')
  }
}

function onSubmitClick(): void {
  if (!props.disabled && !props.busy && props.modelValue.trim()) emit('submit')
}
</script>

<template>
  <form class="flex items-end gap-2" @submit.prevent="onSubmitClick">
    <div
      class="flex flex-1 items-end rounded-2xl border bg-surface px-3 py-2 transition-colors"
      :class="[
        disabled || busy ? 'border-line opacity-60' : 'border-line focus-within:border-primary',
      ]"
    >
      <textarea
        ref="textarea"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled || busy"
        rows="1"
        dir="rtl"
        class="min-h-7 max-h-52 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none disabled:cursor-not-allowed"
        @input="onInput"
        @keydown="onKeydown"
      />
    </div>
    <button
      type="submit"
      :disabled="!modelValue.trim() || disabled || busy"
      :aria-label="'ارسال پیام'"
      class="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-on-primary transition-all duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-elevated disabled:text-ink-muted"
    >
      <svg
        v-if="busy"
        class="size-4 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
      <PhPaperPlaneTilt v-else class="flip-rtl size-4" aria-hidden="true" />
    </button>
  </form>
</template>
