<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { PhCheck, PhCopy, PhCreditCard, PhSpinner } from '@phosphor-icons/vue'
import { listAdminPayments, reconcilePayment } from '@/api/admin'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import type { PaymentHistoryItem } from '@/types/api'

const payments = ref<PaymentHistoryItem[]>([])
const loading = ref(false)
const error = ref<ApiError | null>(null)
const totalPayments = ref(0)
const copiedPaymentId = ref<string | null>(null)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

const pageSize = 20
const page = ref(1)
const offset = ref(0)

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'در انتظار',
  SUCCESS: 'موفق',
  COMPLETED: 'تکمیل',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شده',
}

onMounted(load)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await listAdminPayments({ limit: pageSize, offset: offset.value })
    payments.value = result.items
    totalPayments.value = result.total
  } catch (err) {
    error.value = err instanceof ApiError ? err : new ApiError(0, null, 'خطا در بارگذاری')
  } finally {
    loading.value = false
  }
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

async function onReconcile(paymentId: string): Promise<void> {
  try {
    await reconcilePayment(paymentId)
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err : new ApiError(0, null, 'خطا در بررسی مجدد')
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fa-IR')
  } catch {
    return iso
  }
}

function formatAmount(toman: number): string {
  return toman.toLocaleString('fa-IR')
}

async function copyPaymentId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id)
    copiedPaymentId.value = id
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      copiedPaymentId.value = null
      copyResetTimer = null
    }, 1800)
  } catch {
    error.value = new ApiError(0, null, 'کپی شناسه پرداخت انجام نشد.')
  }
}

const total = totalPayments
</script>

<template>
  <div class="space-y-6 py-2">
    <header class="flex items-center gap-3">
      <span class="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary"><PhCreditCard class="size-5" /></span>
      <div><h1 class="page-heading text-xl font-bold text-ink">پرداخت‌ها</h1><p class="mt-1 text-xs text-ink-muted">تراکنش‌ها، وضعیت پرداخت اعتبار و درخواست‌های نیازمند بررسی مجدد را مدیریت کنید.</p></div>
    </header>

    <!-- Error -->
    <div v-if="error" class="animate-fade-slide-in rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
      {{ apiErrorMessage(error) }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-8">
      <PhSpinner class="size-5 animate-spin text-accent" />
    </div>

    <!-- Payments Table -->
    <div v-else-if="payments.length > 0" class="table-shell animate-fade-slide-in max-h-[32rem] !overflow-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line text-start text-xs text-ink-muted">
            <th class="px-4 py-3 font-medium">تاریخ</th>
            <th class="px-4 py-3 font-medium">شناسه پرداخت</th>
            <th class="px-4 py-3 font-medium">ایمیل کاربر</th>
            <th class="px-4 py-3 font-medium">مبلغ</th>
            <th class="px-4 py-3 font-medium">وضعیت</th>
            <th class="px-4 py-3 font-medium">عملیات</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id" class="border-b border-line/50 transition-colors hover:bg-hover/50">
            <td class="whitespace-nowrap px-4 py-2.5 text-ink-muted">{{ formatDate(p.createdAt) }}</td>
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-1.5" dir="ltr">
                <code class="max-w-32 truncate font-mono text-xs text-ink-muted" :title="p.id">{{ p.id }}</code>
                <button
                  type="button"
                  class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-soft hover:text-primary"
                  :aria-label="copiedPaymentId === p.id ? 'شناسه کپی شد' : 'کپی شناسه پرداخت'"
                  :title="copiedPaymentId === p.id ? 'کپی شد' : 'کپی شناسه پرداخت'"
                  @click="copyPaymentId(p.id)"
                >
                  <PhCheck v-if="copiedPaymentId === p.id" class="size-3.5 text-success" aria-hidden="true" />
                  <PhCopy v-else class="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </td>
            <td class="px-4 py-2.5 text-xs text-ink" dir="ltr">{{ p.userEmail ?? '—' }}</td>
            <td class="px-4 py-2.5 text-ink">{{ formatAmount(p.amountToman) }} تومان</td>
            <td class="px-4 py-2.5">
              <span
                class="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                :class="{
                  'bg-success-soft text-success': p.status === 'SUCCESS',
                  'bg-warning-soft text-warning': p.status === 'PENDING',
                  'bg-danger-soft text-danger': p.status === 'FAILED' || p.status === 'CANCELLED',
                }"
              >
                {{ STATUS_LABELS[p.status] ?? p.status }}
              </span>
            </td>
            <td class="px-4 py-2.5">
              <button
                v-if="p.status === 'PENDING'"
                type="button"
                class="rounded-md bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/20"
                @click="onReconcile(p.id)"
              >
                بررسی مجدد
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty -->
    <div v-else-if="!loading" class="py-8 text-center text-xs text-ink-muted">
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
          :disabled="payments.length < pageSize"
          @click="nextPage"
        >
          بعدی
        </button>
      </div>
    </div>
  </div>
</template>
