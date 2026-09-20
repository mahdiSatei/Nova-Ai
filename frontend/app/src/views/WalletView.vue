<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { PhWallet, PhSpinner } from '@phosphor-icons/vue'
import { useWalletStore } from '@/stores/wallet'
import { getMyPayments, createCreditPurchase } from '@/api/wallet'
import type { PaymentHistoryItem } from '@/types/api'

const wallet = useWalletStore()

const payments = ref<PaymentHistoryItem[]>([])
const loadingPayments = ref(false)
const purchasing = ref(false)
const customCredits = ref<number | null>(null)
const error = ref<string | null>(null)

const PRESET_PACKAGES = [10, 50, 100, 500]

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'در انتظار',
  SUCCESS: 'موفق',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شده',
}

onMounted(async () => {
  await wallet.refresh()
  await loadPayments()
})

async function loadPayments(): Promise<void> {
  loadingPayments.value = true
  try {
    const result = await getMyPayments({ limit: 20 })
    payments.value = result.items
  } catch {
    // silent
  } finally {
    loadingPayments.value = false
  }
}

async function onPurchase(credits: number): Promise<void> {
  purchasing.value = true
  error.value = null
  try {
    const result = await createCreditPurchase(credits)
    // Redirect to the payment provider
    window.location.href = result.paymentUrl
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'خطا در ایجاد درخواست خرید'
  } finally {
    purchasing.value = false
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fa-IR')
  } catch {
    return iso
  }
}

function formatAmount(toman: number): string {
  return toman.toLocaleString('fa-IR')
}
</script>

<template>
  <div class="space-y-8">
    <!-- Balance Card -->
    <div class="rounded-xl border border-line bg-surface p-6">
      <div class="flex items-center gap-3">
        <span class="flex size-10 items-center justify-center rounded-lg bg-accent/10">
          <PhWallet class="size-5 text-accent" />
        </span>
        <div>
          <p class="text-xs text-ink-muted">موجودی کیف پول</p>
          <p class="text-2xl font-bold text-ink">{{ wallet.formattedBalance }} <span class="text-sm font-normal text-ink-muted">اعتبار</span></p>
        </div>
      </div>
    </div>

    <!-- Buy Credits -->
    <div class="rounded-xl border border-line bg-surface p-6">
      <h2 class="mb-4 text-sm font-semibold text-ink">خرید اعتبار</h2>

      <div v-if="error" class="mb-4 rounded-lg bg-danger-soft px-4 py-2 text-xs text-danger">
        {{ error }}
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          v-for="pkg in PRESET_PACKAGES"
          :key="pkg"
          type="button"
          class="rounded-lg border border-line px-4 py-3 text-center transition-colors hover:border-accent hover:bg-accent/5 disabled:opacity-50"
          :disabled="purchasing"
          @click="onPurchase(pkg)"
        >
          <span class="block text-lg font-bold text-ink">{{ pkg }}</span>
          <span class="text-[10px] text-ink-muted">اعتبار</span>
        </button>
      </div>

      <div class="mt-4 flex items-center gap-2">
        <input
          v-model="customCredits"
          type="number"
          min="1"
          placeholder="مقدار دلخواه"
          class="w-32 rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-muted/40 focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          :disabled="purchasing || !customCredits || customCredits < 1"
          @click="onPurchase(customCredits!)"
        >
          {{ purchasing ? 'در حال ایجاد...' : 'خرید' }}
        </button>
      </div>
    </div>

    <!-- Payment History -->
    <div class="rounded-xl border border-line bg-surface p-6">
      <h2 class="mb-4 text-sm font-semibold text-ink">تاریخچه پرداخت</h2>

      <div v-if="loadingPayments" class="flex justify-center py-8">
        <PhSpinner class="size-5 animate-spin text-accent" />
      </div>

      <div v-else-if="payments.length === 0" class="py-8 text-center text-xs text-ink-muted">
        هنوز پرداختی ثبت نشده است
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-line text-start text-xs text-ink-muted">
              <th class="pb-2 font-medium">تاریخ</th>
              <th class="pb-2 font-medium">مبلغ</th>
              <th class="pb-2 font-medium">وضعیت</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in payments" :key="p.id" class="border-b border-line/50">
              <td class="py-2.5 text-ink-muted">{{ formatDate(p.createdAt) }}</td>
              <td class="py-2.5 text-ink">{{ formatAmount(p.amountToman) }} تومان</td>
              <td class="py-2.5">
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
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
