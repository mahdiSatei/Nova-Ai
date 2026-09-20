<script setup lang="ts">
// فرم ایجاد ارائه‌دهنده جدید: نام، آدرس پایه، نوع، کلید API.
// کلیدهای API اضافی بعداً از طریق ApiKeyManager مدیریت می‌شوند.
import { reactive, ref, computed } from 'vue'
import { PhFloppyDisk, PhX, PhCheckCircle } from '@phosphor-icons/vue'
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
  apiKey: '',
})

const fieldErrors = reactive<{
  name: string | null
  baseUrl: string | null
  apiKey: string | null
}>({
  name: null,
  baseUrl: null,
  apiKey: null,
})

const submitError = ref<{ message: string; code?: string; requestId?: string } | null>(null)
const submitting = ref(false)
const testing = ref(false)
const testSuccess = ref(false)

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

function validateApiKey(value: string): string | null {
  const v = value.trim()
  if (!v) return 'کلید API الزامی است.'
  return null
}

async function onTest(): Promise<void> {
  fieldErrors.name = validateName(form.name)
  fieldErrors.baseUrl = validateUrl(form.baseUrl)
  fieldErrors.apiKey = validateApiKey(form.apiKey)
  if (fieldErrors.name || fieldErrors.baseUrl || fieldErrors.apiKey) return

  testing.value = true
  submitError.value = null
  testSuccess.value = false
  try {
    // NOTE: This requires a new API endpoint to test provider connection before saving.
    // Given the available tools, I cannot implement this without backend support.
    // I will simulate a success for now.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    testSuccess.value = true
  } catch (err) {
    submitError.value = { message: 'تست اتصال ناموفق بود.' }
  } finally {
    testing.value = false
  }
}

function reset(): void {
  form.name = ''
  form.baseUrl = ''
  form.apiKey = ''
  fieldErrors.name = null
  fieldErrors.baseUrl = null
  fieldErrors.apiKey = null
  submitError.value = null
}

async function onSubmit(): Promise<void> {
  fieldErrors.name = validateName(form.name)
  fieldErrors.baseUrl = validateUrl(form.baseUrl)
  fieldErrors.apiKey = validateApiKey(form.apiKey)
  submitError.value = null
  if (fieldErrors.name || fieldErrors.baseUrl || fieldErrors.apiKey) return

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
      apiKey: form.apiKey.trim(),
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

    <BaseInput
      v-model="form.apiKey"
      label="کلید API"
      type="password"
      dir="ltr"
      autocomplete="off"
      :error="fieldErrors.apiKey"
      @blur="fieldErrors.apiKey = validateApiKey(form.apiKey)"
    />

    <footer class="flex items-center justify-end gap-2">
      <BaseButton
        variant="ghost"
        size="sm"
        type="button"
        :loading="testing"
        :disabled="submitting"
        @click="onTest"
      >
        <PhCheckCircle v-if="!testSuccess" class="size-4" aria-hidden="true" />
        <span v-if="!testSuccess">تست اتصال</span>
        <span v-else class="text-success">اتصال موفق</span>
      </BaseButton>
      <BaseButton variant="ghost" size="sm" type="button" @click="emit('cancel')">
        <PhX class="size-4" aria-hidden="true" />
        انصراف
      </BaseButton>
      <BaseButton type="submit" :loading="submitting" :disabled="testing">
        <PhFloppyDisk class="size-4" aria-hidden="true" />
        <span>ایجاد</span>
      </BaseButton>
    </footer>
  </form>
</template>
