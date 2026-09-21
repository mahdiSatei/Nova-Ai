<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: any
    options: Array<{ value: any; label: string }>
    label?: string
    error?: string | null
    hint?: string | null
    disabled?: boolean
  }>(),
  { label: '', error: null, hint: null, disabled: false }
)

const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-sm font-medium text-ink-muted">{{ label }}</label>
    <div class="relative">
      <select
        :value="modelValue"
        :disabled="disabled"
        class="w-full cursor-pointer rounded-xl border bg-surface/80 px-3.5 py-2.5 text-ink shadow-inner shadow-black/5 placeholder:text-ink-muted/50 transition-[border-color,box-shadow,background-color] duration-200 focus:bg-surface focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
        :class="[
          error ? 'border-danger' : 'border-line focus:border-primary',
        ]"
        @change="onChange"
      >
        <option v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>
    <p v-if="error || hint" class="text-sm" :class="error ? 'text-danger' : 'text-ink-muted/70'" :role="error ? 'alert' : undefined">
      {{ error ?? hint }}
    </p>
  </div>
</template>