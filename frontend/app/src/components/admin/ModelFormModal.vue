<script setup lang="ts">
// Modal افزودن/ویرایش مدل. validation سمت کلاینت بر اساس BR-005/BR-006:
// displayName 1-80، actualName 1-200، unique بودن displayName توسط سرور بررسی می‌شود (409).
import { reactive, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { createModel, updateModel, discoverModelReasoning, listProviders } from '@/api/admin'
import { formatDateTime } from '@/utils/time'
import type {
  ModelAdmin,
  ModelVisibility,
  ProviderAdmin,
  ReasoningCapabilitySource,
  ReasoningConfigMode,
  ReasoningOutput,
} from '@/types/api'

// فاز ۸ — نمایش منبع هر توان استدلال به مدیر.
const SOURCE_LABELS: Record<ReasoningCapabilitySource, string> = {
  provider_api: 'اعلام‌شده توسط ارائه‌دهنده',
  provider_rules: 'قواعد مستند ارائه‌دهنده',
  manual: 'تنظیم دستی',
  unknown: 'نامشخص',
}

function reasoningSupportLabelFrom(info: ModelAdmin['reasoning']): string {
  const supported = info?.effective.supported
  if (supported === true) return 'پشتیبانی می‌شود'
  if (supported === false) return 'پشتیبانی نمی‌شود'
  return 'نامشخص'
}

// سطح دسترسی مدل. «عمومی» برای همه کاربران، «خصوصی» تنها برای مدیران.
const VISIBILITY_OPTIONS: Array<{ value: ModelVisibility; label: string; hint: string }> = [
  { value: 'public', label: 'عمومی', hint: 'در دسترس همه کاربران' },
  { value: 'private', label: 'خصوصی', hint: 'فقط برای مدیران' },
]

const props = defineProps<{ open: boolean; model: ModelAdmin | null }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: [model: ModelAdmin]
}>()

const form = reactive<{
  displayName: string
  actualName: string
  providerId: string
  visibility: ModelVisibility
  enabled: boolean
  inputPricePer1m: string
  outputPricePer1m: string
  reasoningMode: ReasoningConfigMode
  reasoningSupported: 'unknown' | 'supported' | 'unsupported'
  reasoningOutput: 'unknown' | ReasoningOutput
  reasoningStreaming: boolean
}>({
  displayName: '',
  actualName: '',
  providerId: '',
  visibility: 'public',
  enabled: true,
  inputPricePer1m: '0',
  outputPricePer1m: '0',
  reasoningMode: 'automatic',
  reasoningSupported: 'unknown',
  reasoningOutput: 'unknown',
  reasoningStreaming: false,
})
const fieldErrors = reactive<{ displayName: string | null; actualName: string | null; providerId: string | null }>({
  displayName: null,
  actualName: null,
  providerId: null,
})
const providers = ref<ProviderAdmin[]>([])
const submitError = ref<{ message: string; code?: string; requestId?: string } | null>(null)
const submitting = ref(false)

const isEdit = ref(false)
/** فاز ۸ — آخرین نتیجهٔ کشف خودکار، برای نمایش منبع و زمان کشف. */
const discoveredInfo = ref<ModelAdmin['reasoning'] | null>(null)
const discovering = ref(false)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    isEdit.value = Boolean(props.model)
    form.displayName = props.model?.displayName ?? ''
    form.actualName = props.model?.actualName ?? ''
    form.providerId = props.model?.providerId ?? ''
    form.visibility = props.model?.visibility ?? 'public'
    form.enabled = props.model?.enabled ?? true
    form.inputPricePer1m = String(props.model?.inputPricePer1m ?? 0)
    form.outputPricePer1m = String(props.model?.outputPricePer1m ?? 0)
    // Only manual values are editable here; "automatic" keeps trusting the
    // provider, so the admin's unsaved values never leak into it.
    form.reasoningMode = props.model?.reasoning?.mode ?? 'automatic'
    const manual = props.model?.reasoning?.manual
    form.reasoningSupported =
      manual?.supported === true ? 'supported' : manual?.supported === false ? 'unsupported' : 'unknown'
    form.reasoningOutput = manual?.output ?? 'unknown'
    form.reasoningStreaming = manual?.streaming === true
    // The backend rejects any manual triple that is not internally coherent
    // (e.g. an output/streaming value next to an unknown "supported").
    // Normalize the prefill so the form can only ever submit a valid triple.
    if (form.reasoningSupported === 'unknown') {
      form.reasoningOutput = 'unknown'
      form.reasoningStreaming = false
    } else if (form.reasoningSupported === 'unsupported') {
      if (form.reasoningOutput === 'summary') form.reasoningOutput = 'unknown'
      form.reasoningStreaming = false
    }
    discoveredInfo.value = props.model?.reasoning ?? null
    fieldErrors.displayName = null
    fieldErrors.actualName = null
    fieldErrors.providerId = null
    submitError.value = null

    // Load providers for dropdown
    try {
      const { items } = await listProviders()
      providers.value = items
    } catch {
      // Silently fail - providers list is best-effort
    }
  },
)

function validateDisplay(value: string): string | null {
  const v = value.trim()
  if (!v) return 'نام نمایشی الزامی است.'
  if (v.length < 1 || v.length > 80) return 'نام نمایشی باید ۱ تا ۸۰ کاراکتر باشد.'
  return null
}

function validateActual(value: string): string | null {
  const v = value.trim()
  if (!v) return 'نام سمت ارائه‌دهنده الزامی است.'
  if (v.length < 1 || v.length > 200) return 'نام سمت ارائه‌دهنده باید ۱ تا ۲۰۰ کاراکتر باشد.'
  return null
}

function validateProviderId(value: string): string | null {
  if (!value) return 'ارائه‌دهنده الزامی است.'
  return null
}

function validatePrice(value: string): string | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 'قیمت باید عددی بزرگ‌تر یا مساوی صفر باشد.'
  return null
}

/**
 * Re-run automatic discovery for an existing model. The server keeps whatever
 * the admin configured manually, so this can never wipe a manual choice.
 */
async function onDiscover(): Promise<void> {
  if (!props.model) return
  discovering.value = true
  submitError.value = null
  try {
    const updated = await discoverModelReasoning(props.model.id)
    form.reasoningMode = updated.reasoning?.mode ?? form.reasoningMode
    discoveredInfo.value = updated.reasoning ?? null
    emit('saved', updated)
  } catch (err) {
    if (err instanceof ApiError) {
      submitError.value = { message: apiErrorMessage(err), code: err.code, requestId: err.requestId }
    } else {
      submitError.value = { message: 'کشف خودکار ناموفق بود.' }
    }
  } finally {
    discovering.value = false
  }
}

/** فاز ۸ — پچ استدلال برای ایجاد/ویرایش. */
function reasoningPatch(): {
  mode: ReasoningConfigMode
  supported: boolean | null
  output: ReasoningOutput | null
  streaming: boolean | null
} {
  // A coherent triple only: an unknown/absent "supported" forces the other
  // capabilities to unknown as well, matching the backend's write guard —
  // otherwise the whole save (including a visibility change) is rejected.
  const supported =
    form.reasoningSupported === 'unknown' ? null : form.reasoningSupported === 'supported'
  const output =
    supported === true
      ? form.reasoningOutput === 'unknown'
        ? null
        : form.reasoningOutput
      : supported === false
        ? 'none'
        : null
  return {
    mode: form.reasoningMode,
    supported,
    output,
    // null when support is unknown; false (never true) when unsupported.
    streaming: supported === true ? form.reasoningStreaming : supported === false ? false : null,
  }
}

async function onSubmit(): Promise<void> {
  fieldErrors.displayName = validateDisplay(form.displayName)
  fieldErrors.actualName = validateActual(form.actualName)
  fieldErrors.providerId = validateProviderId(form.providerId)
  submitError.value = null
  if (fieldErrors.displayName || fieldErrors.actualName || fieldErrors.providerId) return
  const inputPriceError = validatePrice(form.inputPricePer1m)
  const outputPriceError = validatePrice(form.outputPricePer1m)
  if (inputPriceError || outputPriceError) {
    submitError.value = { message: inputPriceError ?? outputPriceError ?? 'قیمت مدل نامعتبر است.' }
    return
  }
  const inputPricePer1m = Number(form.inputPricePer1m)
  const outputPricePer1m = Number(form.outputPricePer1m)

  submitting.value = true
  try {
    let saved: ModelAdmin
    if (props.model) {
      saved = await updateModel(props.model.id, {
        displayName: form.displayName.trim(),
        actualName: form.actualName.trim(),
        providerId: form.providerId,
        visibility: form.visibility,
        enabled: form.enabled,
        inputPricePer1m,
        outputPricePer1m,
        reasoning: reasoningPatch(),
      })
    } else {
      saved = await createModel({
        displayName: form.displayName.trim(),
        actualName: form.actualName.trim(),
        providerId: form.providerId,
        visibility: form.visibility,
        enabled: form.enabled,
        inputPricePer1m,
        outputPricePer1m,
        reasoning: reasoningPatch(),
      })
    }
    emit('saved', saved)
    emit('update:open', false)
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'validation_failed') {
        const fe = err.fieldErrors
        fieldErrors.displayName = fe.displayName ?? null
        fieldErrors.actualName = fe.actualName ?? null
        if (!fieldErrors.displayName && !fieldErrors.actualName) {
          submitError.value = { message: apiErrorMessage(err), code: err.code, requestId: err.requestId }
        }
      } else if (err.status === 409 && err.code === 'model_is_default') {
        // فاز ۳: مدل پیش‌فرض سیستم باید عمومی بماند؛ پیش از محدودکردن، مدل
        // پیش‌فرض دیگری انتخاب کنید.
        submitError.value = { message: apiErrorMessage(err), code: err.code, requestId: err.requestId }
      } else if (err.status === 409) {
        fieldErrors.displayName = 'این نام نمایشی قبلاً استفاده شده است.'
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

function onCancel(): void {
  if (!submitting.value) emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-30 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        @click.self="onCancel"
      >
        <div class="panel w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-xl max-h-[min(90dvh,42rem)] overflow-y-auto">
          <h2 class="mb-1 text-base font-semibold">
            {{ isEdit ? 'ویرایش مدل' : 'افزودن مدل' }}
          </h2>
          <p class="mb-3 text-xs text-ink-muted">
            نام نمایشی به کاربران نمایش داده می‌شود؛ نام سمت ارائه‌دهنده به‌طور داخلی استفاده می‌شود.
          </p>

          <ErrorBanner
            v-if="submitError"
            :message="submitError.message"
            :code="submitError.code"
            :request-id="submitError.requestId"
            :show-code="true"
            class="mb-3"
          />

          <form class="flex flex-col gap-3" novalidate @submit.prevent="onSubmit">
            <BaseInput
              v-model="form.displayName"
              label="نام نمایشی"
              dir="ltr"
              hint="۱ تا ۸۰ کاراکتر؛ باید یکتا باشد"
              autocomplete="off"
              :error="fieldErrors.displayName"
              @blur="fieldErrors.displayName = validateDisplay(form.displayName)"
            />
            <BaseInput
              v-model="form.actualName"
              label="نام سمت ارائه‌دهنده"
              dir="ltr"
              hint="۱ تا ۲۰۰ کاراکتر؛ به‌طور داخلی استفاده می‌شود"
              autocomplete="off"
              :error="fieldErrors.actualName"
              @blur="fieldErrors.actualName = validateActual(form.actualName)"
            />

            <label class="flex flex-col gap-1.5 text-sm text-ink">
              <span class="text-xs font-medium text-ink-muted">ارائه‌دهنده</span>
              <select
                v-model="form.providerId"
                class="w-full appearance-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors focus:border-primary"
                :class="fieldErrors.providerId ? 'border-danger' : ''"
              >
                <option value="" disabled>انتخاب ارائه‌دهنده</option>
                <option v-for="p in providers" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
              <p v-if="fieldErrors.providerId" class="text-sm text-danger" role="alert">
                {{ fieldErrors.providerId }}
              </p>
            </label>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BaseInput
                v-model="form.inputPricePer1m"
                label="قیمت ورودی (تومان / ۱M توکن)"
                type="number"
                min="0"
                step="0.01"
                dir="ltr"
                hint="صفر یعنی رایگان"
                autocomplete="off"
              />
              <BaseInput
                v-model="form.outputPricePer1m"
                label="قیمت خروجی (تومان / ۱M توکن)"
                type="number"
                min="0"
                step="0.01"
                dir="ltr"
                hint="استدلال هم با این نرخ محاسبه می‌شود"
                autocomplete="off"
              />
            </div>

            <label class="flex flex-col gap-2 text-sm text-ink">
              <span class="text-xs font-medium text-ink-muted">سطح دسترسی</span>
              <select
                v-model="form.visibility"
                class="w-full appearance-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors focus:border-primary"
              >
                <option v-for="opt in VISIBILITY_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }} — {{ opt.hint }}
                </option>
              </select>
            </label>

            <label class="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                v-model="form.enabled"
                type="checkbox"
                class="size-4 cursor-pointer rounded border-line bg-elevated accent-primary"
              />
              <span>فعال برای کاربران</span>
            </label>

            <!-- فاز ۸ — پیکربندی استدلال: خودکار (اعتماد به ارائه‌دهنده) یا دستی -->
            <fieldset class="flex flex-col gap-3 rounded-lg border border-line p-3">
              <legend class="px-1 text-xs font-medium text-ink-muted">استدلال (Thinking)</legend>

              <label class="flex flex-col gap-1.5 text-xs">
                <span class="text-ink-muted">
                  منبع پیکربندی
                  <span v-if="discoveredInfo?.discovered.discoveredAt" class="text-ink-muted/60">
                    · آخرین کشف: {{ formatDateTime(discoveredInfo.discovered.discoveredAt) }}
                  </span>
                </span>
                <select
                  v-model="form.reasoningMode"
                  class="w-full appearance-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors focus:border-primary"
                >
                  <option value="automatic">خودکار — اعتماد به کشف ارائه‌دهنده</option>
                  <option value="manual">دستی — پیکربندی توسط مدیر</option>
                </select>
              </label>

              <p v-if="discoveredInfo" class="text-[11px] text-ink-muted/80">
                کشف‌شده:
                {{ reasoningSupportLabelFrom(discoveredInfo) }}
                <span v-if="discoveredInfo.discovered.output === 'summary'"> · خلاصه قابل نمایش</span>
                <span dir="auto"> · منبع: {{ SOURCE_LABELS[discoveredInfo.discovered.sources.supported] }}</span>
              </p>

              <template v-if="form.reasoningMode === 'manual'">
                <label class="flex flex-col gap-1.5 text-xs">
                  <span class="text-ink-muted">پشتیبانی استدلال</span>
                  <select
                    v-model="form.reasoningSupported"
                    class="w-full appearance-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors focus:border-primary"
                  >
                    <option value="unknown">نامشخص</option>
                    <option value="supported">پشتیبانی می‌شود</option>
                    <option value="unsupported">پشتیبانی نمی‌شود</option>
                  </select>
                </label>

                <label v-if="form.reasoningSupported === 'supported'" class="flex flex-col gap-1.5 text-xs">
                  <span class="text-ink-muted">خروجی قابل نمایش</span>
                  <select
                    v-model="form.reasoningOutput"
                    class="w-full appearance-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors focus:border-primary"
                  >
                    <option value="unknown">نامشخص</option>
                    <option value="none">هیچ (استدلال داخلی)</option>
                    <option value="summary">خلاصهٔ قابل نمایش</option>
                  </select>
                </label>

                <label
                  v-if="form.reasoningSupported === 'supported' && form.reasoningOutput === 'summary'"
                  class="flex cursor-pointer items-center gap-2 text-xs text-ink"
                >
                  <input
                    v-model="form.reasoningStreaming"
                    type="checkbox"
                    class="size-4 cursor-pointer rounded border-line bg-elevated accent-primary"
                  />
                  <span>خلاصه به‌صورت زنده استریم می‌شود</span>
                </label>
              </template>

              <BaseButton
                v-if="isEdit"
                variant="secondary"
                size="sm"
                type="button"
                :loading="discovering"
                @click="onDiscover"
              >
                کشف مجدد از ارائه‌دهنده
              </BaseButton>
            </fieldset>

            <footer class="flex items-center justify-end gap-2">
              <BaseButton variant="ghost" size="sm" type="button" :disabled="submitting" @click="onCancel">
                انصراف
              </BaseButton>
              <BaseButton type="submit" :loading="submitting">
                {{ isEdit ? 'ذخیره' : 'ایجاد' }}
              </BaseButton>
            </footer>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active {
  transition: opacity 180ms ease;
}
.fade-leave-active {
  transition: opacity 120ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.fade-enter-active .panel {
  animation: panel-pop 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.fade-leave-active .panel {
  transition: transform 120ms ease, opacity 120ms ease;
}
.fade-leave-to .panel {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

@keyframes panel-pop {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
