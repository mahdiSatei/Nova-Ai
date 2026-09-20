<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { PhFloppyDisk, PhX, PhCheckCircle } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { createProvider, updateProvider, validateProvider } from '@/api/admin'
import type { ProviderAdmin } from '@/types/api'

const props = defineProps<{
  provider?: ProviderAdmin | null
}>()

const emit = defineEmits<{
  saved: [provider: ProviderAdmin]
  cancel: []
}>()

const isEdit = ref(false)

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
const testResult = ref<{ success: boolean; message: string } | null>(null)

watch(
  () => props.provider,
  (p) => {
    if (p) {
      isEdit.value = true
      form.name = p.name
      form.baseUrl = p.baseUrl
      form.apiKey = ''
    } else {
      isEdit.value = false
      reset()
    }
    testResult.value = null
  },
  { immediate: true },
)

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
  form.apiKey = ''
  fieldErrors.name = null
  fieldErrors.baseUrl = null
  fieldErrors.apiKey = null
  submitError.value = null
  testResult.value = null
}

async function onTest(): Promise<void> {
  if (!isEdit.value || !props.provider) return
  testing.value = true
  testResult.value = null
  try {
    await validateProvider(props.provider.id)
    testResult.value = { success: true, message: 'اتصال موفق' }
  } catch {
    testResult.value = { success: false, message: 'تست اتصال ناموفق بود.' }
  } finally {
    testing.value = false
  }
}

async function onSubmit(): Promise<void> {
  fieldErrors.name = validateName(form.name)
  fieldErrors.baseUrl = validateUrl(form.baseUrl)
  submitError.value = null
  if (fieldErrors.name || fieldErrors.baseUrl) return

  if (!isEdit.value) {
    fieldErrors.apiKey = form.apiKey.trim() ? null : 'کلید API الزامی است.'
    if (fieldErrors.apiKey) return
  }

  submitting.value = true
  try {
    if (isEdit.value && props.provider) {
      const body: { name?: string; baseUrl?: string; apiKey?: string } = {}
      if (form.name.trim() !== props.provider.name) body.name = form.name.trim()
      if (form.baseUrl.trim() !== props.provider.baseUrl) body.baseUrl = form.baseUrl.trim()
      if (form.apiKey.trim()) body.apiKey = form.apiKey.trim()
      const next = await updateProvider(props.provider.id, body)
      emit('saved', next)
    } else {
      const id = form.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
      if (!id) {
        fieldErrors.name = 'شناسه ارائه‌دهنده نامعتبر است.'
        submitting.value = false
        return
      }
      const next = await createProvider({
        id,
        name: form.name.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
      })
      emit('saved', next)
      reset()
    }
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
    <h3 class="text-sm font-medium text-ink">{{ isEdit ? 'ویرایش ارائه‌دهنده' : 'افزودن ارائه‌دهنده جدید' }}</h3>

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
      :label="isEdit ? 'کلید API جدید (خالی برای حفظ فعلی)' : 'کلید API'"
      type="password"
      dir="ltr"
      autocomplete="off"
      :error="fieldErrors.apiKey"
    />

    <div v-if="isEdit && testResult" class="flex items-center gap-2 rounded-lg border p-3" :class="testResult.success ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5'">
      <PhCheckCircle class="size-5 shrink-0" :class="testResult.success ? 'text-success' : 'text-danger'" />
      <span class="text-sm" :class="testResult.success ? 'text-success' : 'text-danger'">{{ testResult.message }}</span>
    </div>

    <footer class="flex items-center justify-end gap-2">
      <BaseButton
        v-if="isEdit"
        variant="ghost"
        size="sm"
        type="button"
        :loading="testing"
        :disabled="submitting"
        @click="onTest"
      >
        <PhCheckCircle v-if="!testResult?.success" class="size-4" aria-hidden="true" />
        <span v-if="!testResult?.success">تست اتصال</span>
        <span v-else class="text-success">اتصال موفق</span>
      </BaseButton>
      <BaseButton variant="ghost" size="sm" type="button" @click="emit('cancel')">
        <PhX class="size-4" aria-hidden="true" />
        انصراف
      </BaseButton>
      <BaseButton type="submit" :loading="submitting">
        <PhFloppyDisk class="size-4" aria-hidden="true" />
        <span>{{ isEdit ? 'ذخیره' : 'ایجاد' }}</span>
      </BaseButton>
    </footer>
  </form>
</template>
