<script setup lang="ts">
// فرم پیکربندی provider: baseUrl + apiKey. طبق FR-021..FR-023، BR-011.
// قبل از ذخیره، سرور credential را probe می‌کند؛ در خطا هیچ‌چیز ذخیره نمی‌شود.
// Cleartext credential هرگز به UI نمی‌آید؛ فقط `apiKeyMasked`.
import { reactive, ref } from 'vue'
import { PhFloppyDisk, PhArrowsCounterClockwise } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { getProvider, updateProvider } from '@/api/admin'
import { formatDateTime } from '@/utils/time'
import type { CentralProviderPublic } from '@/types/api'

const props = defineProps<{ provider: CentralProviderPublic | null }>()
const emit = defineEmits<{ saved: [provider: CentralProviderPublic] }>()

const form = reactive({ baseUrl: props.provider?.baseUrl ?? '', apiKey: '' })
const fieldErrors = reactive<{ baseUrl: string | null; apiKey: string | null }>({ baseUrl: null, apiKey: null })
const submitError = ref<{ message: string; code?: string; requestId?: string } | null>(null)
const submitting = ref(false)

function reset(): void {
  form.baseUrl = props.provider?.baseUrl ?? ''
  form.apiKey = ''
  fieldErrors.baseUrl = null
  fieldErrors.apiKey = null
  submitError.value = null
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

async function onSubmit(): Promise<void> {
  fieldErrors.baseUrl = validateUrl(form.baseUrl)
  fieldErrors.apiKey = form.apiKey.trim() ? null : 'کلید API را وارد کنید.'
  submitError.value = null
  if (fieldErrors.baseUrl || fieldErrors.apiKey) return

  submitting.value = true
  try {
    const next = await updateProvider({ baseUrl: form.baseUrl.trim(), apiKey: form.apiKey })
    emit('saved', next)
    form.apiKey = ''
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'validation_failed') {
        const fe = err.fieldErrors
        fieldErrors.baseUrl = fe.baseUrl ?? null
        fieldErrors.apiKey = fe.apiKey ?? null
        if (!fieldErrors.baseUrl && !fieldErrors.apiKey) {
          submitError.value = { message: apiErrorMessage(err), code: err.code, requestId: err.requestId }
        }
      } else if (err.status === 422) {
        // Probe failed — server rejecting credentials; FR-022
        fieldErrors.apiKey = apiErrorMessage(err) || 'کلید API توسط ارائه‌دهنده رد شد.'
        submitError.value = { message: 'اعتبارسنجی ناموفق. هیچ تغییری ذخیره نشد.', code: err.code, requestId: err.requestId }
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

defineExpose({ reset, reload: async () => { const p = await getProvider(); form.baseUrl = p.baseUrl } })
</script>

<template>
  <form class="flex flex-col gap-5" novalidate @submit.prevent="onSubmit">
    <ErrorBanner
      v-if="submitError"
      :message="submitError.message"
      :code="submitError.code"
      :request-id="submitError.requestId"
      :show-code="true"
    />

    <BaseInput
      v-model="form.baseUrl"
      label="آدرس پایه (Base URL)"
      type="url"
      hint="مثلاً https://api.example.com/v1"
      autocomplete="off"
      :error="fieldErrors.baseUrl"
      @blur="fieldErrors.baseUrl = validateUrl(form.baseUrl)"
    />

    <div class="flex flex-col gap-1.5">
      <label for="provider-apikey" class="text-sm font-medium text-ink-muted">
        کلید API
        <span v-if="provider?.isConfigured" class="ms-2 text-xs text-ink-muted/70">
          (برای به‌روزرسانی، مقدار جدید وارد کنید)
        </span>
      </label>

      <input
        id="provider-apikey"
        v-model="form.apiKey"
        type="password"
        autocomplete="off"
        placeholder="sk-..."
        :aria-invalid="fieldErrors.apiKey ? 'true' : undefined"
        class="w-full rounded-lg border bg-surface px-3.5 py-2.5 font-mono text-sm text-ink placeholder:text-ink-muted/50 transition-colors"
        :class="fieldErrors.apiKey ? 'border-danger' : 'border-line focus:border-primary'"
      />

      <p
        v-if="fieldErrors.apiKey"
        class="text-sm text-danger"
        role="alert"
      >{{ fieldErrors.apiKey }}</p>

      <div
        v-else-if="provider?.isConfigured && provider.apiKeyMasked"
        class="mt-1 flex items-center gap-2 text-xs text-ink-muted"
      >
        <span>کلید فعلی:</span>
        <span class="rounded bg-elevated px-2 py-1 font-mono text-ink">{{ provider.apiKeyMasked }}</span>
      </div>

      <p
        v-else
        class="text-sm text-ink-muted/70"
      >کلید فقط یک‌بار در هنگام ذخیره نمایش داده می‌شود (ماسک).</p>
    </div>

    <div v-if="provider?.lastValidatedAt" class="text-xs text-ink-muted/70">
      آخرین اعتبارسنجی موفق: <span class="font-mono">{{ formatDateTime(provider.lastValidatedAt) }}</span>
    </div>

    <footer class="flex items-center justify-end gap-2">
      <BaseButton variant="ghost" size="sm" type="button" @click="reset">
        <PhArrowsCounterClockwise class="size-4" aria-hidden="true" />
        انصراف از تغییرات
      </BaseButton>
      <BaseButton type="submit" :loading="submitting">
        <PhFloppyDisk class="size-4" aria-hidden="true" />
        <span>اعتبارسنجی و ذخیره</span>
      </BaseButton>
    </footer>
  </form>
</template>
