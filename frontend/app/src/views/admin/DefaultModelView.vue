<script setup lang="ts">
// انتخاب‌گر مدل پیش‌فرض سیستم. طبق FR-031..FR-034 + BR-010: فقط مدل‌های enabled
// قابل انتخاب هستند. تغییر پیش‌فرض اتمیک است؛ ارسال null پیش‌فرض را پاک می‌کند.
import { computed, onMounted, ref } from 'vue'
import { PhStar, PhEraser } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { listAdminModels, getConfig, putConfig } from '@/api/admin'
import type { ModelAdmin } from '@/types/api'

const models = ref<ModelAdmin[]>([])
const currentDefaultId = ref<string | null>(null)
const pending = ref<string | null>(null) // null = unchanged, '' = clear
const loading = ref(true)
const loadError = ref<ApiError | null>(null)
const submitError = ref<ApiError | null>(null)
const submitting = ref(false)
const confirmOpen = ref(false)

const enabledModels = computed(() => models.value.filter((m) => m.enabled))

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const [page, cfg] = await Promise.all([listAdminModels(), getConfig()])
    models.value = page.items
    currentDefaultId.value = cfg.defaultModelId
  } catch (err) {
    if (err instanceof ApiError) loadError.value = err
  } finally {
    loading.value = false
  }
}

onMounted(load)

function selectModel(id: string): void {
  pending.value = id
  submitError.value = null
}

function askClear(): void {
  pending.value = ''
  submitError.value = null
  confirmOpen.value = true
}

async function onConfirmSave(): Promise<void> {
  if (pending.value === null || submitting.value) return
  // اگر clear و قبلاً null بود، کاری نکن
  if (pending.value === '' && currentDefaultId.value === null) {
    confirmOpen.value = false
    pending.value = null
    return
  }

  submitting.value = true
  submitError.value = null
  try {
    const body = pending.value === '' ? { defaultModelId: null } : { defaultModelId: pending.value }
    const next = await putConfig(body)
    currentDefaultId.value = next.defaultModelId
    pending.value = null
    confirmOpen.value = false
  } catch (err) {
    if (err instanceof ApiError) {
      submitError.value = err
      // FR-032: disabled model was sent; refresh to reconcile.
      if (err.status === 422) await load()
    }
  } finally {
    submitting.value = false
  }
}

function effectiveSelection(): string | null {
  return pending.value !== null ? (pending.value === '' ? null : pending.value) : currentDefaultId.value
}
</script>

<template>
  <section>
    <header class="mb-4 flex items-center gap-3">
      <PhStar class="size-5 text-primary" aria-hidden="true" />
      <h1 class="text-base font-semibold">مدل پیش‌فرض</h1>
    </header>

    <div v-if="loading" class="h-48 animate-pulse rounded-card bg-surface" />

    <div v-else-if="loadError" class="flex flex-col gap-3">
      <ErrorBanner
        :message="apiErrorMessage(loadError)"
        :code="loadError.code"
        :request-id="loadError.requestId"
        :show-code="true"
      />
      <button class="self-start text-sm text-primary hover:underline" @click="load">تلاش مجدد</button>
    </div>

    <EmptyState
      v-else-if="enabledModels.length === 0"
      title="مدل فعالی وجود ندارد"
      description="ابتدا از بخش «کاتالوگ مدل‌ها» یک مدل فعال اضافه کنید."
    />

    <div v-else class="flex flex-col gap-4">
      <ErrorBanner
        v-if="submitError"
        :message="apiErrorMessage(submitError)"
        :code="submitError.code"
        :request-id="submitError.requestId"
        :show-code="true"
      />

      <fieldset class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <legend class="px-1 text-xs text-ink-muted">انتخاب مدل پیش‌فرض سیستم</legend>

        <label
          v-for="m in enabledModels"
          :key="m.id"
          class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-elevated"
          :class="effectiveSelection() === m.id ? 'bg-primary/10' : ''"
        >
          <input
            type="radio"
            name="defaultModel"
            :value="m.id"
            :checked="effectiveSelection() === m.id"
            class="size-4 cursor-pointer accent-primary"
            @change="selectModel(m.id)"
          />
          <span class="flex-1 text-sm text-ink">{{ m.displayName }}</span>
          <span class="font-mono text-xs text-ink-muted/70">{{ m.actualName }}</span>
          <PhStar v-if="m.id === currentDefaultId" class="size-4 text-warning" :title="'پیش‌فرض فعلی'" aria-hidden="true" />
        </label>
      </fieldset>

      <div class="flex items-center justify-start gap-2">
        <BaseButton variant="ghost" size="sm" :disabled="currentDefaultId === null || submitting" @click="askClear">
          <PhEraser class="size-4" aria-hidden="true" />
          پاک کردن پیش‌فرض
        </BaseButton>
        <BaseButton
          size="sm"
          :loading="submitting"
          :disabled="pending === null"
          @click="onConfirmSave"
        >
          ذخیره
        </BaseButton>
      </div>

      <p class="text-xs text-ink-muted/70">
        تغییر پیش‌فرض اتمیک است؛ کاربرانی که قبلاً انتخاب صریح کرده‌اند تحت تأثیر قرار نمی‌گیرند (طبق §7.3).
      </p>
    </div>

    <ConfirmModal
      :open="confirmOpen"
      title="پاک کردن مدل پیش‌فرض"
      description="تا زمانی که پیش‌فرض جدیدی انتخاب نشود، کاربران جدید پیام «چت پیکربندی نشده» را می‌بینند."
      confirm-label="پاک کردن"
      variant="danger"
      :busy="submitting"
      @update:open="(v: boolean) => (confirmOpen = v)"
      @confirm="onConfirmSave"
    />
  </section>
</template>
