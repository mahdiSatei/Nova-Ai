<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { PhArrowRight, PhCheckCircle, PhCreditCard, PhWallet, PhSpinner } from '@phosphor-icons/vue'
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

const selectedCredits = ref<number | null>(null)
const selectedPackageLabel = computed(() =>
  selectedCredits.value ? `${selectedCredits.value.toLocaleString('fa-IR')} اعتبار` : '',
)

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
  const normalized = Math.floor(Number(credits))
  if (!Number.isFinite(normalized) || normalized < 1) {
    error.value = 'تعداد اعتبار باید حداقل ۱ باشد.'
    return
  }

  purchasing.value = true
  selectedCredits.value = normalized
  error.value = null
  try {
    const result = await createCreditPurchase(normalized)
    // The backend returns the provider URL after creating a pending purchase.
    window.location.assign(result.paymentUrl)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'خطا در ایجاد درخواست خرید'
    selectedCredits.value = null
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
  <div class="mx-auto w-full max-w-5xl space-y-8 py-4 sm:py-8">
    <div class="flex items-center justify-between gap-3">
      <RouterLink
        to="/chat"
        class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <PhArrowRight class="size-4" aria-hidden="true" />
        <span>بازگشت به گفتگو</span>
      </RouterLink>
    </div>

    <!-- Balance Card -->
    <div class="surface-card interactive-lift overflow-hidden border-primary/20 bg-gradient-to-br from-primary-soft via-surface to-accent/5 p-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent/70 text-on-primary shadow-lg shadow-primary/20">
            <PhWallet class="size-5" />
          </span>
          <div>
            <p class="text-xs text-ink-muted">موجودی کیف پول</p>
            <p class="mt-1 text-2xl font-bold text-ink">{{ wallet.formattedBalance }} <span class="text-sm font-normal text-ink-muted">اعتبار</span></p>
          </div>
        </div>
        <p class="text-xs text-ink-muted/80">اعتبار برای استفاده از چت و جستجوی وب</p>
      </div>
    </div>

    <!-- Buy Credits -->
    <div class="surface-card p-6">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-bold text-ink">افزایش اعتبار</h2>
          <p class="mt-1 text-xs leading-5 text-ink-muted">یک بسته را انتخاب کنید تا به درگاه پرداخت منتقل شوید.</p>
        </div>
        <span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <PhCreditCard class="size-4.5" aria-hidden="true" />
        </span>
      </div>

      <div v-if="error" class="mt-4 animate-fade-slide-in rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
        {{ error }}
      </div>

      <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          v-for="pkg in PRESET_PACKAGES"
          :key="pkg"
          type="button"
          class="group relative rounded-xl border border-line bg-surface px-4 py-4 text-center transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary-soft/40 hover:shadow-md disabled:cursor-wait disabled:opacity-50"
          :disabled="purchasing"
          @click="onPurchase(pkg)"
        >
          <PhCheckCircle class="absolute end-2 top-2 size-3.5 text-primary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
          <span class="block text-xl font-bold text-ink">{{ pkg.toLocaleString('fa-IR') }}</span>
          <span class="text-[10px] text-ink-muted">اعتبار</span>
        </button>
      </div>

      <div class="mt-5 rounded-xl border border-dashed border-line bg-elevated/30 p-3">
        <p class="mb-2 text-xs font-medium text-ink">یا مقدار دلخواه وارد کنید</p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            v-model="customCredits"
            type="number"
            min="1"
            step="1"
            placeholder="مثلاً ۷۵ اعتبار"
            class="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            @keyup.enter="customCredits && onPurchase(customCredits)"
          />
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="purchasing || !customCredits || customCredits < 1"
            @click="onPurchase(customCredits!)"
          >
            <PhSpinner v-if="purchasing" class="me-2 size-4 animate-spin" aria-hidden="true" />
            {{ purchasing ? 'در حال انتقال…' : 'ادامه پرداخت' }}
          </button>
        </div>
        <p v-if="selectedCredits" class="mt-2 text-[11px] text-primary">در حال آماده‌سازی خرید {{ selectedPackageLabel }}…</p>
      </div>
    </div>

    <!-- Payment History -->
    <div class="surface-card p-6">
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
