<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
    size?: 'sm' | 'md'
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'primary', size: 'md', loading: false, disabled: false, type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-medium shadow-sm transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-px hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
    :class="[
      size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-sm',
      {
        'bg-gradient-to-br from-primary to-primary-deep text-on-primary hover:shadow-primary/25': variant === 'primary',
        'border border-line bg-elevated text-ink hover:border-primary/40 hover:bg-line': variant === 'secondary',
        'bg-gradient-to-br from-danger to-danger/80 text-white hover:shadow-danger/20': variant === 'danger',
        'text-ink-muted hover:bg-elevated hover:text-ink': variant === 'ghost',
      },
    ]"
  >
    <svg
      v-if="loading"
      class="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    </svg>
    <slot />
  </button>
</template>
