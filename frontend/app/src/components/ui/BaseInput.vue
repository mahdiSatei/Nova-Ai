<script setup lang="ts">
// BaseInput با پشتیبانی داخلی از نمایش/پنهان کردن رمز عبور وقتی type='password'.
// وقتی فعال است، یک دکمه چشم در انتهای اینپوت اضافه می‌شود که بین type='password'
// و type='text' جابه‌جا می‌کند. state به‌صورت محلی نگه‌داری می‌شود و با unmount پاک می‌شود.
import { computed, ref, useId } from 'vue'
import { PhEye, PhEyeSlash } from '@phosphor-icons/vue'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string
    type?: string
    error?: string | null
    hint?: string
    autocomplete?: string
    /** جهت متن داخل اینپوت. پیش‌فرض rtl. برای email/password → 'ltr'. */
    dir?: 'rtl' | 'ltr'
  }>(),
  { dir: 'rtl' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string]; blur: [] }>()

const id = useId()
const revealed = ref(false)
const isPassword = computed(() => props.type === 'password')
const effectiveType = computed(() =>
  isPassword.value && revealed.value ? 'text' : (props.type ?? 'text'),
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-sm font-medium text-ink-muted">{{ label }}</label>
    <div class="relative">
      <input
        :id="id"
        :type="effectiveType"
        :value="modelValue"
        :autocomplete="autocomplete"
        :dir="dir"
        :lang="dir === 'ltr' ? 'en' : 'fa'"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error || hint ? `${id}-desc` : undefined"
        class="w-full rounded-xl border bg-surface/80 px-3.5 py-2.5 text-ink shadow-inner shadow-black/5 placeholder:text-ink-muted/50 transition-[border-color,box-shadow,background-color] duration-200 focus:bg-surface focus:ring-4 focus:ring-primary/10"
        :class="[
          error ? 'border-danger' : 'border-line focus:border-primary',
          dir === 'ltr' ? 'text-left' : 'text-right',
          isPassword ? 'pr-10' : '',
        ]"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @blur="emit('blur')"
      />
      <button
        v-if="isPassword"
        type="button"
        tabindex="-1"
        :aria-label="revealed ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'"
        :aria-pressed="revealed"
        :title="revealed ? 'پنهان کردن' : 'نمایش'"
        class="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-ink-muted transition-colors hover:text-ink focus-visible:text-ink"
        @mousedown.prevent
        @click="revealed = !revealed"
      >
        <PhEyeSlash v-if="revealed" class="size-4" aria-hidden="true" />
        <PhEye v-else class="size-4" aria-hidden="true" />
      </button>
    </div>
    <p v-if="error || hint" :id="`${id}-desc`" class="text-sm" :class="error ? 'text-danger' : 'text-ink-muted/70'" :role="error ? 'alert' : undefined">
      {{ error ?? hint }}
    </p>
  </div>
</template>
