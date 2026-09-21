<script setup lang="ts">
// جدول مدل‌ها برای پنل ادمین. ستون‌ها: display name، actual name، enabled، is default.
// عملیات: ویرایش، toggle enabled (با تأیید برای غیرفعال‌سازی مدل پیش‌فرض)، حذف (با تأیید).
import { PhPencilSimple, PhStar, PhToggleLeft } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import type {
  ModelAdmin,
  ModelVisibility,
  ReasoningCapabilitySource,
  ReasoningConfigMode,
} from '@/types/api'

// فاز ۳: برچسب سطح دسترسی برای هر مدل.
const VISIBILITY_LABELS: Record<ModelVisibility, string> = {
  public: 'عمومی',
  private: 'خصوصی',
}

const VISIBILITY_CLASSES: Record<ModelVisibility, string> = {
  public: 'bg-success/15 text-success',
  private: 'bg-warning/15 text-warning',
}

// فاز ۸ — نمایش توان مؤثر استدلال و منبع آن برای مدیر. «نامشخص» هرگز به
// «پشتیبانی نمی‌شود» تبدیل نمی‌شود؛ این دو حالت برای مدیر متفاوت‌اند.
const SOURCE_LABELS: Record<ReasoningCapabilitySource, string> = {
  provider_api: 'اعلام‌شده توسط ارائه‌دهنده',
  provider_rules: 'قواعد مستند ارائه‌دهنده',
  manual: 'تنظیم دستی',
  unknown: 'نامشخص',
}

const MODE_LABELS: Record<ReasoningConfigMode, string> = {
  automatic: 'خودکار',
  manual: 'دستی',
}

function reasoningSupportLabel(m: ModelAdmin): string {
  const supported = m.reasoning?.effective.supported
  if (supported === true) return 'پشتیبانی می‌شود'
  if (supported === false) return 'پشتیبانی نمی‌شود'
  return 'نامشخص'
}

const props = defineProps<{
  models: ModelAdmin[]
  defaultModelId: string | null
  /** id مدلی که عملیات پیش‌فرض روی آن در جریان است (برای غیرفعال‌کردن ستاره). */
  defaultBusyId?: string | null
}>()
const emit = defineEmits<{
  edit: [m: ModelAdmin]
  toggle: [m: ModelAdmin]
  remove: [m: ModelAdmin]
  'set-default': [m: ModelAdmin]
  'clear-default': [m: ModelAdmin]
}>()

function isCurrentDefault(m: ModelAdmin): boolean {
  return m.isDefault || m.id === props.defaultModelId
}

function isEligible(m: ModelAdmin): boolean {
  return m.enabled && (m.visibility ?? 'public') === 'public'
}

function onStarClick(m: ModelAdmin): void {
  if (isCurrentDefault(m)) {
    // ستاره طلایی → پاک‌کردن پیش‌فرض (با تأیید در صفحه والد).
    emit('clear-default', m)
  } else if (isEligible(m)) {
    emit('set-default', m)
  }
}

function starTitle(m: ModelAdmin): string {
  if (isCurrentDefault(m)) return 'پیش‌فرض فعلی — برای پاک‌کردن کلیک کنید'
  if (!m.enabled) return 'این مدل غیرفعال است و نمی‌تواند پیش‌فرض باشد'
  if ((m.visibility ?? 'public') !== 'public') return 'این مدل عمومی نیست و نمی‌تواند پیش‌فرض باشد'
  return 'تعیین به‌عنوان مدل پیش‌فرض'
}
</script>

<template>
  <div class="max-h-[32rem] overflow-auto rounded-card border border-line bg-surface">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-line bg-elevated/40 text-xs uppercase tracking-wide text-ink-muted">
          <th class="px-4 py-2.5 text-start font-medium">نام نمایشی</th>
          <th class="px-4 py-2.5 text-start font-medium">نام ارائه‌دهنده</th>
          <th class="px-4 py-2.5 text-start font-medium">سطح دسترسی</th>
          <th class="px-4 py-2.5 text-start font-medium">استدلال</th>
          <th class="px-4 py-2.5 text-start font-medium">وضعیت</th>
          <th class="px-4 py-2.5 text-start font-medium">پیش‌فرض</th>
          <th class="px-4 py-2.5 text-end font-medium">عملیات</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="m in models"
          :key="m.id"
          class="border-b border-line last:border-b-0 transition-colors hover:bg-elevated/30"
        >
          <td class="px-4 py-3 font-medium text-ink">{{ m.displayName }}</td>
          <td class="px-4 py-3 font-mono text-xs text-ink-muted">{{ m.actualName }}</td>
          <td class="px-4 py-3">
            <span
              class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs"
              :class="VISIBILITY_CLASSES[m.visibility]"
            >
              {{ VISIBILITY_LABELS[m.visibility] }}
            </span>
          </td>
          <td class="px-4 py-3">
            <div class="flex flex-col gap-1 text-xs">
              <span
                class="inline-flex w-fit items-center rounded-full px-2.5 py-0.5"
                :class="
                  m.reasoning?.effective.supported === true
                    ? 'bg-primary/15 text-primary'
                    : m.reasoning?.effective.supported === false
                      ? 'bg-line text-ink-muted'
                      : 'bg-warning/15 text-warning'
                "
              >
                {{ reasoningSupportLabel(m) }}
              </span>
              <span v-if="m.reasoning?.effective.output === 'summary'" class="text-ink-muted">
                خلاصه<span v-if="m.reasoning.effective.streaming"> · زنده</span>
              </span>
              <span dir="auto" class="text-[11px] text-ink-muted/70">
                {{ MODE_LABELS[m.reasoning?.mode ?? 'automatic'] }} ·
                {{ SOURCE_LABELS[m.reasoning?.discovered.sources.supported ?? 'unknown'] }}
              </span>
            </div>
          </td>
          <td class="px-4 py-3">
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition-colors"
              :class="m.enabled ? 'bg-success/15 text-success' : 'bg-line text-ink-muted'"
              :aria-pressed="m.enabled"
              :title="m.enabled ? 'غیرفعال کردن' : 'فعال کردن'"
              @click="emit('toggle', m)"
            >
              <PhToggleLeft class="size-3" aria-hidden="true" />
              {{ m.enabled ? 'فعال' : 'غیرفعال' }}
            </button>
          </td>
          <td class="px-4 py-3 text-center">
            <button
              type="button"
              class="inline-flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors"
              :class="
                isCurrentDefault(m)
                  ? 'text-warning'
                  : isEligible(m)
                    ? 'text-ink-muted/40 hover:bg-warning/10 hover:text-warning'
                    : 'cursor-not-allowed text-ink-muted/20'
              "
              :disabled="defaultBusyId === m.id || (!isEligible(m) && !isCurrentDefault(m))"
              :title="starTitle(m)"
              :aria-label="
                isCurrentDefault(m)
                  ? 'پیش‌فرض فعلی — برای پاک‌کردن کلیک کنید'
                  : starTitle(m)
              "
              :aria-pressed="isCurrentDefault(m)"
              @click="onStarClick(m)"
            >
              <PhStar
                class="size-5"
                :weight="isCurrentDefault(m) ? 'fill' : 'regular'"
                aria-hidden="true"
              />
            </button>
          </td>
          <td class="px-4 py-3 text-end">
            <div class="inline-flex items-center gap-1">
              <BaseButton variant="ghost" size="sm" :aria-label="'ویرایش'" @click="emit('edit', m)">
                <PhPencilSimple class="size-4" aria-hidden="true" />
              </BaseButton>
              <BaseButton variant="ghost" size="sm" :aria-label="'حذف'" class="text-ink-muted hover:text-danger" @click="emit('remove', m)">
                <span class="sr-only">حذف</span>
                <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M10 11v6M14 11v6" stroke-linecap="round" />
                </svg>
              </BaseButton>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
