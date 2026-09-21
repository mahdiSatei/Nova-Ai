<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  PhArrowRight,
  PhChartDonut,
  PhClock,
  PhCoins,
  PhHash,
  PhReceipt,
  PhSpinner,
  PhTrendUp,
} from '@phosphor-icons/vue'
import { getMyUsageSummary } from '@/api/usage'
import { formatCredits } from '@/utils/credits'
import TokenDonut from '@/components/usage/TokenDonut.vue'
import type { UserUsageSummary } from '@/types/api'

const data = ref<UserUsageSummary | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

function format(value: number): string {
  return Number(value || 0).toLocaleString('fa-IR')
}

function formatToman(value: number): string {
  return `${format(value)} تومان`
}

function date(value: string): string {
  return new Date(value).toLocaleDateString('fa-IR')
}

const completionRate = computed(() => {
  if (!data.value?.totals.totalTokens) return 0
  return Math.round((data.value.totals.outputTokens / data.value.totals.totalTokens) * 100)
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await getMyUsageSummary()
  } catch {
    error.value = 'بارگذاری گزارش مصرف انجام نشد. دوباره تلاش کنید.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="mx-auto w-full max-w-6xl space-y-6 py-5 sm:py-8">
    <RouterLink
      to="/chat"
      class="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-ink-muted transition-all hover:bg-hover hover:text-ink"
    >
      <PhArrowRight class="size-4" aria-hidden="true" />
      <span>بازگشت به گفتگو</span>
    </RouterLink>

    <header class="usage-hero surface-card relative overflow-hidden p-5 sm:p-7">
      <div class="relative z-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div class="mb-3 inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
            <PhChartDonut class="size-4" aria-hidden="true" />
            گزارش شخصی مصرف
          </div>
          <h1 class="page-heading text-2xl font-bold text-ink sm:text-3xl">داشبورد مصرف</h1>
          <p class="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
            نمایی شفاف از توکن‌ها، درخواست‌ها و هزینه‌ای که برای استفاده از مدل‌ها پرداخت کرده‌اید.
          </p>
        </div>
        <div v-if="data" class="rounded-2xl border border-line/70 bg-bg/40 px-4 py-3 text-start backdrop-blur-sm">
          <p class="text-xs text-ink-muted">سهم توکن خروجی</p>
          <p class="mt-1 text-2xl font-bold text-primary">{{ format(completionRate) }}٪</p>
        </div>
      </div>
    </header>

    <div v-if="loading" class="flex justify-center py-20">
      <PhSpinner class="size-7 animate-spin text-primary" aria-label="در حال بارگذاری" />
    </div>

    <div v-else-if="error" class="animate-fade-slide-in rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
      {{ error }}
      <button type="button" class="ms-2 underline" @click="load">تلاش مجدد</button>
    </div>

    <template v-else-if="data">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="surface-card interactive-lift p-5">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-xs text-ink-muted"><PhHash class="size-4 text-primary" /> کل توکن‌ها</span>
            <span class="rounded-lg bg-primary-soft p-2 text-primary"><PhTrendUp class="size-4" /></span>
          </div>
          <p class="mt-4 text-2xl font-bold text-ink">{{ format(data.totals.totalTokens) }}</p>
          <p class="mt-1 text-xs text-ink-muted">ورودی و خروجی مدل‌ها</p>
        </div>

        <div class="surface-card interactive-lift p-5">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-xs text-ink-muted"><PhReceipt class="size-4 text-accent" /> تعداد درخواست‌ها</span>
            <span class="rounded-lg bg-hover p-2 text-accent"><PhReceipt class="size-4" /></span>
          </div>
          <p class="mt-4 text-2xl font-bold text-ink">{{ format(data.totals.requestCount) }}</p>
          <p class="mt-1 text-xs text-ink-muted">پاسخ‌های تکمیل‌شده</p>
        </div>

        <div class="surface-card interactive-lift p-5">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-xs text-ink-muted"><PhCoins class="size-4 text-warning" /> هزینه مصرف‌شده</span>
            <span class="rounded-lg bg-warning/10 p-2 text-warning"><PhCoins class="size-4" /></span>
          </div>
          <p class="mt-4 text-xl font-bold text-ink sm:text-2xl">{{ formatToman(data.totals.chargedCost) }}</p>
          <p class="mt-1 text-xs text-ink-muted">مجموع هزینه به تومان</p>
        </div>

        <div class="surface-card interactive-lift p-5">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-xs text-ink-muted"><PhCoins class="size-4 text-primary" /> کردیت کسرشده از کیف پول</span>
            <span class="rounded-lg bg-primary-soft p-2 text-primary"><PhCoins class="size-4" /></span>
          </div>
          <p class="mt-4 text-2xl font-bold text-ink">{{ formatCredits(data.totals.deductedCredits) }}</p>
          <p class="mt-1 text-xs text-ink-muted">کسرشده از کیف پول</p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="surface-card interactive-lift p-5 sm:p-6">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-bold text-ink">ترکیب مصرف توکن</h2>
              <p class="mt-1 text-xs text-ink-muted">درصد هر بخش از کل توکن‌های مصرف‌شده</p>
            </div>
            <span class="rounded-xl bg-primary-soft p-2 text-primary"><PhChartDonut class="size-5" /></span>
          </div>
          <div class="mt-6">
            <TokenDonut
              :input-tokens="data.totals.inputTokens"
              :output-tokens="data.totals.outputTokens"
              :reasoning-tokens="data.totals.reasoningTokens"
              :total-tokens="data.totals.totalTokens"
            />
          </div>
        </div>

        <div class="surface-card interactive-lift p-5 sm:p-6">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-bold text-ink">خلاصه مالی</h2>
              <p class="mt-1 text-xs text-ink-muted">جمع هزینه‌های ثبت‌شده در گزارش مصرف</p>
            </div>
            <span class="rounded-xl bg-warning/10 p-2 text-warning"><PhCoins class="size-5" /></span>
          </div>
          <div class="mt-6 space-y-4">
            <div class="flex items-center justify-between rounded-xl bg-hover/60 px-4 py-3 text-sm">
              <span class="text-ink-muted">هزینه به تومان</span>
              <strong class="text-ink">{{ formatToman(data.totals.chargedCost) }}</strong>
            </div>
            <div class="flex items-center justify-between rounded-xl bg-hover/60 px-4 py-3 text-sm">
              <span class="text-ink-muted">کردیت واقعی کسرشده</span>
              <strong class="text-primary">{{ formatCredits(data.totals.deductedCredits) }} کردیت</strong>
            </div>
            <div class="flex items-center justify-between rounded-xl bg-hover/60 px-4 py-3 text-sm">
              <span class="text-ink-muted">آخرین فعالیت</span>
              <strong class="text-ink">{{ data.recent[0] ? date(data.recent[0].createdAt) : '—' }}</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="surface-card overflow-hidden">
        <div class="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-4 sm:px-6">
          <div>
            <h2 class="text-sm font-bold text-ink">آخرین درخواست‌ها</h2>
            <p class="mt-1 text-xs text-ink-muted">جزئیات ۱۰ مصرف اخیر شما</p>
          </div>
          <PhClock class="size-5 text-ink-muted" aria-hidden="true" />
        </div>
        <div v-if="data.recent.length === 0" class="py-10 text-center text-xs text-ink-muted">هنوز مصرفی ثبت نشده است.</div>
        <div v-else class="max-h-96 divide-y divide-line/70 overflow-y-auto">
          <div v-for="item in data.recent" :key="item.id" class="flex flex-col gap-3 px-5 py-4 text-xs transition-colors hover:bg-hover/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div class="min-w-0">
              <p class="truncate font-medium text-ink">{{ item.modelName ?? 'مدل' }}</p>
              <p class="mt-1 text-ink-muted">{{ date(item.createdAt) }} · {{ format(item.totalTokens) }} توکن کل</p>
              <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                <span>ورودی: <strong class="text-ink">{{ format(item.inputTokens) }}</strong> توکن</span>
                <span>خروجی: <strong class="text-ink">{{ format(item.outputTokens) }}</strong> توکن</span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="rounded-full bg-primary-soft px-2.5 py-1 text-primary">{{ formatCredits(item.deductedCredits) }} کردیت</span>
              <span class="rounded-full bg-warning/10 px-2.5 py-1 text-warning">{{ formatToman(item.chargedCost) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.usage-hero::after {
  position: absolute;
  inset-inline-end: -5rem;
  top: -7rem;
  width: 18rem;
  height: 18rem;
  border-radius: 999px;
  background: var(--app-primary-soft);
  content: '';
  filter: blur(1px);
}
</style>
