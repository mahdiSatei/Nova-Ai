<script setup lang="ts">
// جدول مدل‌ها برای پنل ادمین. ستون‌ها: display name، actual name، enabled، is default.
// عملیات: ویرایش، toggle enabled (با تأیید برای غیرفعال‌سازی مدل پیش‌فرض)، حذف (با تأیید).
import { PhPencilSimple, PhStar, PhStarFour, PhToggleLeft } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import type { ModelAdmin, ModelVisibility } from '@/types/api'

// فاز ۳: برچسب سطح دسترسی برای هر مدل.
const VISIBILITY_LABELS: Record<ModelVisibility, string> = {
  public: 'عمومی',
  commercial: 'تجاری',
  private: 'خصوصی',
}

const VISIBILITY_CLASSES: Record<ModelVisibility, string> = {
  public: 'bg-success/15 text-success',
  commercial: 'bg-primary/15 text-primary',
  private: 'bg-warning/15 text-warning',
}

defineProps<{ models: ModelAdmin[]; defaultModelId: string | null }>()
const emit = defineEmits<{ edit: [m: ModelAdmin]; toggle: [m: ModelAdmin]; remove: [m: ModelAdmin] }>()
</script>

<template>
  <div class="overflow-x-auto rounded-card border border-line bg-surface">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-line bg-elevated/40 text-xs uppercase tracking-wide text-ink-muted">
          <th class="px-4 py-2.5 text-start font-medium">نام نمایشی</th>
          <th class="px-4 py-2.5 text-start font-medium">نام ارائه‌دهنده</th>
          <th class="px-4 py-2.5 text-start font-medium">سطح دسترسی</th>
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
          <td class="px-4 py-3">
            <PhStar v-if="m.isDefault || m.id === defaultModelId" class="size-4 text-warning" :title="'مدل پیش‌فرض'" aria-hidden="true" />
            <PhStarFour v-else class="size-4 text-ink-muted/30" aria-hidden="true" />
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
