<script setup lang="ts">
// Modal افزودن/ویرایش مدل. validation سمت کلاینت بر اساس BR-005/BR-006:
// displayName 1-80، actualName 1-200، unique بودن displayName توسط سرور بررسی می‌شود (409).
import { reactive, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { createModel, updateModel } from '@/api/admin'
import type { ModelAdmin } from '@/types/api'

const props = defineProps<{ open: boolean; model: ModelAdmin | null }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: [model: ModelAdmin]
}>()

const form = reactive({ displayName: '', actualName: '', enabled: true })
const fieldErrors = reactive<{ displayName: string | null; actualName: string | null }>({
  displayName: null,
  actualName: null,
})
const submitError = ref<{ message: string; code?: string; requestId?: string } | null>(null)
const submitting = ref(false)

const isEdit = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    isEdit.value = Boolean(props.model)
    form.displayName = props.model?.displayName ?? ''
    form.actualName = props.model?.actualName ?? ''
    form.enabled = props.model?.enabled ?? true
    fieldErrors.displayName = null
    fieldErrors.actualName = null
    submitError.value = null
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

async function onSubmit(): Promise<void> {
  fieldErrors.displayName = validateDisplay(form.displayName)
  fieldErrors.actualName = validateActual(form.actualName)
  submitError.value = null
  if (fieldErrors.displayName || fieldErrors.actualName) return

  submitting.value = true
  try {
    let saved: ModelAdmin
    if (props.model) {
      saved = await updateModel(props.model.id, {
        displayName: form.displayName.trim(),
        actualName: form.actualName.trim(),
        enabled: form.enabled,
      })
    } else {
      saved = await createModel({
        displayName: form.displayName.trim(),
        actualName: form.actualName.trim(),
        enabled: form.enabled,
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
        class="fixed inset-0 z-30 flex items-center justify-center bg-bg/70 p-4"
        role="dialog"
        aria-modal="true"
        @click.self="onCancel"
      >
        <div class="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-xl">
          <h2 class="mb-1 text-lg font-semibold">
            {{ isEdit ? 'ویرایش مدل' : 'افزودن مدل' }}
          </h2>
          <p class="mb-4 text-sm text-ink-muted">
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

          <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
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

            <label class="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                v-model="form.enabled"
                type="checkbox"
                class="size-4 cursor-pointer rounded border-line bg-elevated accent-primary"
              />
              <span>فعال برای کاربران</span>
            </label>

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
.fade-enter-active,
.fade-leave-active {
  transition: opacity 150ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
