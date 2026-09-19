<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: any
    options: Array<{ value: any; label: string }>
    label?: string
    error?: string | null
    hint?: string
    disabled?: boolean
  }>(),
  { label: '', error: null, hint: null, disabled: false }
)

const emit = defineEmits<{ 'update:modelValue': [value: any] }>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-sm font-medium text-ink-muted">{{ label }}</label>
    <div class="relative">
      <select
        :value="modelValue"
        :disabled="disabled"
        class="w-full rounded-lg border bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-muted/50 transition-colors duration-150"
        :class="[
          error ? 'border-danger' : 'border-line focus:border-primary',
        ]"
        @update:modelValue="emit('update:modelValue', $event.target.value)"
        @change="emit('update:modelValue', $event.target.value)"
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