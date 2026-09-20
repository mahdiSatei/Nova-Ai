<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { PhSpinner } from '@phosphor-icons/vue'
import { listAdminPayments, listAdminCreditPurchases, reconcilePayment } from '@/api/admin'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import type { PaymentHistoryItem } from '@/types/api'

type Tab = 'payments' | 'purchases'
const activeTab = ref<Tab>('payments')

const payments = ref<PaymentHistoryItem[]>([])
const purchases = ref<Array<{
  id: string
  userId: string
  credits: number
  amountToman: number
  pricePerCreditToman: number
  status: string
  paymentId: string | null
  createdAt: string
  completedAt: string | null
}>>([])
const loading = ref(false)
const error = ref<ApiError | null>(null)
const totalPayments = ref(0)
const totalPurchases = ref(0)

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
    if (activeTab.value === 'payments') {
      const result = await listAdminPayments({ limit: pageSize, offset: offset.value })
      payments.value = result.items as PaymentHistoryItem[]
      totalPayments.value = result.total
    } else {
      const result = await listAdminCreditPurchases({ limit: pageSize, offset: offset.value })
      purchases.value = result.items as any[]
      totalPurchases.value = result.total
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err : new ApiError(0, null, 'خطا در بارگذاری')
  } finally {
    loading.value = false
  }
}

function switchTab(tab: Tab): void {
  activeTab.value = tab
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

const total = activeTab.value === 'payments' ? totalPayments : totalPurchases
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-lg font-semibold text-ink">پرداخت‌ها</h1>

    <!-- Tabs -->
    <div class="flex gap-1 rounded-lg border border-line bg-surface p-1">
      <button
        type="button"
        class="flex-1 rounded-md px-4 py-2 text-xs font-medium transition-colors"
        :class="activeTab === 'payments' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'"
        @click="switchTab('payments')"
      >
        پرداخت‌ها
      </button>
      <button
        type="button"
        class="flex-1 rounded-md px-4 py-2 text-xs font-medium transition-colors"
        :class="activeTab === 'purchases' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'"
        @click="switchTab('purchases')"
      >
        خرید اعتبار
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

    <!-- Payments Table -->
    <div v-else-if="activeTab === 'payments' && payments.length > 0" class="overflow-x-auto rounded-xl border border-line bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line text-start text-xs text-ink-muted">
            <th class="px-4 py-3 font-medium">تاریخ</th>
            <th class="px-4 py-3 font-medium">شناسه</th>
            <th class="px-4 py-3 font-medium">مبلغ</th>
            <th class="px-4 py-3 font-medium">وضعیت</th>
            <th class="px-4 py-3 font-medium">عملیات</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id" class="border-b border-line/50">
            <td class="whitespace-nowrap px-4 py-2.5 text-ink-muted">{{ formatDate(p.createdAt) }}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-ink-muted">{{ p.id.slice(0, 8) }}...</td>
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

    <!-- Purchases Table -->
    <div v-else-if="activeTab === 'purchases' && purchases.length > 0" class="overflow-x-auto rounded-xl border border-line bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line text-start text-xs text-ink-muted">
            <th class="px-4 py-3 font-medium">تاریخ</th>
            <th class="px-4 py-3 font-medium">شناسه</th>
            <th class="px-4 py-3 font-medium">اعتبار</th>
            <th class="px-4 py-3 font-medium">مبلغ</th>
            <th class="px-4 py-3 font-medium">وضعیت</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in purchases" :key="p.id" class="border-b border-line/50">
            <td class="whitespace-nowrap px-4 py-2.5 text-ink-muted">{{ formatDate(p.createdAt) }}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-ink-muted">{{ p.id.slice(0, 8) }}...</td>
            <td class="px-4 py-2.5 text-ink">{{ p.credits }}</td>
            <td class="px-4 py-2.5 text-ink">{{ formatAmount(p.amountToman) }} تومان</td>
            <td class="px-4 py-2.5">
              <span
                class="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                :class="{
                  'bg-success-soft text-success': p.status === 'COMPLETED',
                  'bg-warning-soft text-warning': p.status === 'PENDING',
                  'bg-danger-soft text-danger': p.status === 'FAILED' || p.status === 'CANCELLED',
                }"
              >
                {{ STATUS_LABELS[p.status] ?? p.status }}
              </span>
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
          :disabled="(activeTab === 'payments' ? payments.length : purchases.length) < pageSize"
          @click="nextPage"
        >
          بعدی
        </button>
      </div>
    </div>
  </div>
</template>
