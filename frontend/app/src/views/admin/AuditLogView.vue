<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { PhDownloadSimple, PhSpinner, PhMagnifyingGlass } from '@phosphor-icons/vue'
import { listAuditLogs } from '@/api/audit'
import type { AuditLogEntry } from '@/types/api'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'

const items = ref<AuditLogEntry[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<ApiError | null>(null)
const exporting = ref(false)

const pageSize = 20
const page = ref(1)
const offset = ref(0)

// Filters
const actionFilter = ref('')
const targetTypeFilter = ref('')
const fromFilter = ref('')
const toFilter = ref('')

const ACTION_OPTIONS = [
  { value: '', label: 'همه عملیات‌ها' },
  { value: 'payment_created', label: 'ایجاد پرداخت' },
  { value: 'payment_succeeded', label: 'پرداخت موفق' },
  { value: 'payment_failed', label: 'پرداخت ناموفق' },
  { value: 'credit_granted', label: 'افزودن اعتبار' },
  { value: 'credit_deducted', label: 'کسر اعتبار' },
  { value: 'model_pricing_changed', label: 'تغییر قیمت مدل' },
  { value: 'model_access_changed', label: 'تغییر دسترسی مدل' },
  { value: 'admin_access', label: 'دسترسی مدیریتی' },
]

const TARGET_OPTIONS = [
  { value: '', label: 'همه اهداف' },
  { value: 'payment', label: 'پرداخت' },
  { value: 'wallet', label: 'کیف پول' },
  { value: 'model', label: 'مدل' },
  { value: 'config', label: 'تنظیمات' },
]

const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  ACTION_OPTIONS.filter(o => o.value).map(o => [o.value, o.label]),
)

const RESULT_LABELS: Record<string, string> = {
  success: 'موفق',
  failure: 'ناموفق',
  system: 'سیستمی',
}

function currentQuery() {
  return {
    ...(actionFilter.value ? { action: actionFilter.value } : {}),
    ...(targetTypeFilter.value ? { targetType: targetTypeFilter.value } : {}),
    ...(fromFilter.value ? { from: fromFilter.value } : {}),
    ...(toFilter.value ? { to: toFilter.value } : {}),
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? '').replaceAll('"', '""')
  return `"${text}"`
}

async function exportLogs(): Promise<void> {
  exporting.value = true
  error.value = null
  try {
    const exportPageSize = 100
    const exported: AuditLogEntry[] = []
    let exportOffset = 0
    let exportTotal = 0

    do {
      const result = await listAuditLogs({
        ...currentQuery(),
        limit: exportPageSize,
        offset: exportOffset,
      })
      exported.push(...result.items)
      exportTotal = result.total
      exportOffset += result.items.length
      if (result.items.length === 0) break
    } while (exported.length < exportTotal)

    const rows = [
      ['زمان', 'عملیات', 'هدف', 'شناسه هدف', 'نتیجه', 'جزئیات'],
      ...exported.map((item) => [
        formatDateTime(item.createdAt),
        ACTION_LABELS[item.action] ?? item.action,
        item.targetType,
        item.targetId ?? '',
        RESULT_LABELS[item.result] ?? item.result,
        formatMeta(item.metadata),
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    error.value = err instanceof ApiError ? err : new ApiError(0, null, 'خروجی گرفتن از گزارش انجام نشد.')
  } finally {
    exporting.value = false
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await listAuditLogs({
      ...currentQuery(),
      limit: pageSize,
      offset: offset.value,
    })
    items.value = result.items
    total.value = result.total
  } catch (err) {
    error.value = err instanceof ApiError ? err : new ApiError(0, null, 'خطا در بارگذاری گزارش')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function applyFilters(): void {
  page.value = 1
  offset.value = 0
  void load()
}

function nextPage(): void {
  page.value++
  offset.value = (page.value - 1) * pageSize
  void load()
}

function prevPage(): void {
  if (page.value > 1) {
    page.value--
    offset.value = (page.value - 1) * pageSize
    void load()
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fa-IR')
  } catch {
    return iso
  }
}

function formatMeta(meta: Record<string, unknown>): string {
  const keys = Object.keys(meta)
  if (keys.length === 0) return '—'
  return keys.map(k => `${k}: ${JSON.stringify(meta[k])}`).join(', ')
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-lg font-semibold text-ink">گزارش عملیات</h1>
      <p class="mt-1 text-xs text-ink-muted">رویدادهای حساس سیستم، نتیجه عملیات و جزئیات تغییرات را پیگیری کنید.</p>
    </header>

    <!-- Filters -->
    <div class="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
      <div>
        <label class="mb-1 block text-[10px] text-ink-muted">عملیات</label>
        <select
          v-model="actionFilter"
          class="rounded-lg border border-line px-3 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
          @change="applyFilters"
        >
          <option v-for="opt in ACTION_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div>
        <label class="mb-1 block text-[10px] text-ink-muted">هدف</label>
        <select
          v-model="targetTypeFilter"
          class="rounded-lg border border-line px-3 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
          @change="applyFilters"
        >
          <option v-for="opt in TARGET_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div>
        <label class="mb-1 block text-[10px] text-ink-muted">از تاریخ</label>
        <input
          v-model="fromFilter"
          type="datetime-local"
          class="rounded-lg border border-line px-3 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
          @change="applyFilters"
        />
      </div>

      <div>
        <label class="mb-1 block text-[10px] text-ink-muted">تا تاریخ</label>
        <input
          v-model="toFilter"
          type="datetime-local"
          class="rounded-lg border border-line px-3 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
          @change="applyFilters"
        />
      </div>

      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
        @click="applyFilters"
      >
        <PhMagnifyingGlass class="size-3" />
        جستجو
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated disabled:cursor-wait disabled:opacity-50"
        :disabled="exporting"
        @click="exportLogs"
      >
        <PhDownloadSimple class="size-3" :class="{ 'animate-bounce': exporting }" />
        {{ exporting ? 'در حال آماده‌سازی…' : 'خروجی CSV' }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="rounded-lg bg-danger-soft px-4 py-2 text-xs text-danger">
      {{ apiErrorMessage(error) }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-8">
      <PhSpinner class="size-5 animate-spin text-accent" />
    </div>

    <!-- Table -->
    <div v-else-if="items.length > 0" class="max-h-[32rem] overflow-auto rounded-xl border border-line bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line text-start text-xs text-ink-muted">
            <th class="px-4 py-3 font-medium">زمان</th>
            <th class="px-4 py-3 font-medium">عملیات</th>
            <th class="px-4 py-3 font-medium">هدف</th>
            <th class="px-4 py-3 font-medium">نتیجه</th>
            <th class="px-4 py-3 font-medium">جزئیات</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" class="border-b border-line/50">
            <td class="whitespace-nowrap px-4 py-2.5 text-ink-muted">{{ formatDateTime(item.createdAt) }}</td>
            <td class="px-4 py-2.5 text-ink">{{ ACTION_LABELS[item.action] ?? item.action }}</td>
            <td class="px-4 py-2.5 text-ink-muted">{{ item.targetType }}{{ item.targetId ? ` / ${item.targetId.slice(0, 8)}` : '' }}</td>
            <td class="px-4 py-2.5">
              <span
                class="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                :class="{
                  'bg-success-soft text-success': item.result === 'success',
                  'bg-danger-soft text-danger': item.result === 'failure',
                  'bg-elevated text-ink-muted': item.result === 'system',
                  'bg-warning-soft text-warning': !['success', 'failure', 'system'].includes(item.result),
                }"
              >
                {{ RESULT_LABELS[item.result] ?? item.result }}
              </span>
            </td>
            <td class="max-w-xs truncate px-4 py-2.5 text-xs text-ink-muted">{{ formatMeta(item.metadata) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty -->
    <div v-else class="py-8 text-center text-xs text-ink-muted">
      رکوردی یافت نشد
    </div>

    <!-- Pagination -->
    <div v-if="total > pageSize" class="flex items-center justify-between">
      <span class="text-xs text-ink-muted">{{ total }} رکورد</span>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-elevated disabled:opacity-40"
          :disabled="page <= 1"
          @click="prevPage"
        >
          قبلی
        </button>
        <span class="flex items-center px-3 text-xs text-ink-muted">صفحه {{ page }}</span>
        <button
          type="button"
          class="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-elevated disabled:opacity-40"
          :disabled="items.length < pageSize"
          @click="nextPage"
        >
          بعدی
        </button>
      </div>
    </div>
  </div>
</template>
