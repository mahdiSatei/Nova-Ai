<script setup lang="ts">
// فرم ایجاد ارائه‌دهنده جدید: نام، آدرس پایه، نوع.
// کلیدهای API جداگانه از طریق ApiKeyManager مدیریت می‌شوند.
import { reactive, ref, computed } from 'vue'
import { PhFloppyDisk, PhX } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { createProvider } from '@/api/admin'
import type { ProviderAdmin } from '@/types/api'

const emit = defineEmits<{
  saved: [provider: ProviderAdmin]
  cancel: []
}>()

const form = reactive({
  name: '',
  baseUrl: '',
  type: 'openai-compatible' as const,
})

const fieldErrors = reactive<{
  name: string | null
  baseUrl: string | null
}>({
  name: null,
  baseUrl: null,
})

const submitError = ref<{ message: string; code?: string; requestId?: string } | null>(null)
const submitting = ref(false)

// Auto-generate id from name
const generatedId = computed(() => {
  return form.name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
})

function validateName(value: string): string | null {
  const v = value.trim()
  if (!v) return 'نام ارائه‌دهنده الزامی است.'
  if (v.length < 1 || v.length > 80) return 'نام باید ۱ تا ۸۰ کاراکتر باشد.'
  return null
}

function validateUrl(value: string): string | null {
  const v = value.trim()
  if (!v) return 'آدرس پایه الزامی است.'
  try {
    const url = new URL(v)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'آدرس باید با http یا https شروع شود.'
  } catch {
    return 'آدرس معتبر نیست.'
  }
  return null
}

function reset(): void {
  form.name = ''
  form.baseUrl = ''
  fieldErrors.name = null
  fieldErrors.baseUrl = null
  submitError.value = null
}

async function onSubmit(): Promise<void> {
  fieldErrors.name = validateName(form.name)
  fieldErrors.baseUrl = validateUrl(form.baseUrl)
  submitError.value = null
  if (fieldErrors.name || fieldErrors.baseUrl) return

  const id = generatedId.value
  if (!id) {
    fieldErrors.name = 'شناسه ارائه‌دهنده نامعتبر است.'
    return
  }

  submitting.value = true
  try {
    const next = await createProvider({
      id,
      name: form.name.trim(),
      type: form.type,
      baseUrl: form.baseUrl.trim(),
      apiKey: 'pending-validation', // Placeholder - keys are added via ApiKeyManager
    })
    emit('saved', next)
    reset()
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'validation_failed') {
        const fe = err.fieldErrors
        fieldErrors.name = fe.name ?? null
        fieldErrors.baseUrl = fe.baseUrl ?? null
        if (!fieldErrors.name && !fieldErrors.baseUrl) {
          submitError.value = { message: apiErrorMessage(err), code: err.code, requestId: err.requestId }
        }
      } else if (err.code === 'provider_name_taken') {
        fieldErrors.name = 'نام ارائه‌دهنده قبلاً استفاده شده است.'
      } else {
        submitError.value = { message: apiErrorMessage(err), code: err.code, requestId: err.requestId }
      }
    } else {
      submitError.value = { message: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.' }
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-4 rounded-lg border border-line p-4" novalidate @submit.prevent="onSubmit">
    <h3 class="text-sm font-medium text-ink">افزودن ارائه‌دهنده جدید</h3>

    <ErrorBanner
      v-if="submitError"
      :message="submitError.message"
      :code="submitError.code"
      :request-id="submitError.requestId"
      :show-code="true"
    />

    <BaseInput
      v-model="form.name"
      label="نام ارائه‌دهنده"
      hint="مثلاً OpenAI, Anthropic, OpenRouter"
      autocomplete="off"
      :error="fieldErrors.name"
      @blur="fieldErrors.name = validateName(form.name)"
    />

    <div v-if="form.name" class="text-xs text-ink-muted">
      شناسه: <code class="font-mono">{{ generatedId }}</code>
    </div>

    <BaseInput
      v-model="form.baseUrl"
      label="آدرس پایه (Base URL)"
      type="url"
      dir="ltr"
      hint="مثلاً https://api.openai.com/v1"
      autocomplete="off"
      :error="fieldErrors.baseUrl"
      @blur="fieldErrors.baseUrl = validateUrl(form.baseUrl)"
    />

    <footer class="flex items-center justify-end gap-2">
      <BaseButton variant="ghost" size="sm" type="button" @click="emit('cancel')">
        <PhX class="size-4" aria-hidden="true" />
        انصراف
      </BaseButton>
      <BaseButton type="submit" :loading="submitting">
        <PhFloppyDisk class="size-4" aria-hidden="true" />
        <span>ایجاد</span>
      </BaseButton>
    </footer>
  </form>
</template>
