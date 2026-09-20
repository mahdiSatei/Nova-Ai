<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { PhArrowRight, PhChartDonut, PhClock, PhCoins, PhSpinner, PhTrendUp } from '@phosphor-icons/vue'
import { getMyUsageSummary } from '@/api/usage'
import type { UserUsageSummary } from '@/types/api'

const data = ref<UserUsageSummary | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const inputPercent = computed(() => percentage(data.value?.totals.inputTokens ?? 0, data.value?.totals.totalTokens ?? 0))
const outputPercent = computed(() => percentage(data.value?.totals.outputTokens ?? 0, data.value?.totals.totalTokens ?? 0))
const reasoningPercent = computed(() => percentage(data.value?.totals.reasoningTokens ?? 0, data.value?.totals.totalTokens ?? 0))

function percentage(value: number, total: number): number {
  if (!total || !value) return 0
  return Math.round((value / total) * 100)
}

function format(value: number): string {
  return Number(value || 0).toLocaleString('fa-IR')
}

function date(value: string): string {
  return new Date(value).toLocaleDateString('fa-IR')
}

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
  <section class="mx-auto w-full max-w-5xl space-y-6 py-5 sm:py-8">
    <RouterLink
      to="/chat"
      class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-hover hover:text-ink"
    >
      <PhArrowRight class="size-4" aria-hidden="true" />
      <span>بازگشت به گفتگو</span>
    </RouterLink>

    <header class="flex items-center gap-3">
      <span class="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <PhChartDonut class="size-5" aria-hidden="true" />
      </span>
      <div>
        <h1 class="text-xl font-bold text-ink">داشبورد مصرف</h1>
        <p class="mt-1 text-xs text-ink-muted">نمای کلی استفاده از توکن و اعتبار شما</p>
      </div>
    </header>

    <div v-if="loading" class="flex justify-center py-20">
      <PhSpinner class="size-7 animate-spin text-primary" aria-label="در حال بارگذاری" />
    </div>

    <div v-else-if="error" class="animate-fade-slide-in rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
      {{ error }}
      <button type="button" class="ms-2 underline" @click="load">تلاش مجدد</button>
    </div>

    <template v-else-if="data">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="surface-card interactive-lift p-5">
          <div class="flex items-center gap-2 text-xs text-ink-muted"><PhTrendUp class="size-4 text-primary" /> کل توکن‌ها</div>
          <p class="mt-3 text-2xl font-bold text-ink">{{ format(data.totals.totalTokens) }}</p>
          <p class="mt-1 text-xs text-ink-muted">{{ format(data.totals.requestCount) }} درخواست</p>
        </div>
        <div class="surface-card interactive-lift p-5">
          <div class="flex items-center gap-2 text-xs text-ink-muted"><PhCoins class="size-4 text-warning" /> اعتبار مصرف‌شده</div>
          <p class="mt-3 text-2xl font-bold text-ink">{{ format(data.totals.chargedCredits) }}</p>
          <p class="mt-1 text-xs text-ink-muted">اعتبار</p>
        </div>
        <div class="surface-card interactive-lift p-5">
          <div class="flex items-center gap-2 text-xs text-ink-muted"><PhClock class="size-4 text-accent" /> آخرین فعالیت</div>
          <p class="mt-3 text-lg font-bold text-ink">{{ data.recent[0] ? date(data.recent[0].createdAt) : '—' }}</p>
          <p class="mt-1 text-xs text-ink-muted">بر اساس پاسخ‌های تکمیل‌شده</p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="surface-card interactive-lift p-5">
          <h2 class="text-sm font-bold text-ink">ترکیب مصرف توکن</h2>
          <p class="mt-1 text-xs text-ink-muted">درصد هر بخش از کل توکن‌های مصرف‌شده</p>
          <div class="mt-6 space-y-4">
            <div v-for="item in [
              { label: 'ورودی', value: data.totals.inputTokens, percent: inputPercent, color: 'bg-primary' },
              { label: 'خروجی', value: data.totals.outputTokens, percent: outputPercent, color: 'bg-accent' },
              { label: 'استدلال', value: data.totals.reasoningTokens, percent: reasoningPercent, color: 'bg-warning' },
            ]" :key="item.label">
              <div class="mb-1.5 flex justify-between text-xs">
                <span class="text-ink-muted">{{ item.label }} · {{ format(item.value) }}</span>
                <strong class="text-ink">{{ item.percent }}٪</strong>
              </div>
              <div class="h-2.5 overflow-hidden rounded-full bg-elevated/80">
                <div class="h-full rounded-full transition-all duration-700 ease-out" :class="item.color" :style="{ width: `${item.percent}%` }" />
              </div>
            </div>
          </div>
        </div>

        <div class="surface-card interactive-lift p-5">
          <h2 class="text-sm font-bold text-ink">آخرین درخواست‌ها</h2>
          <div v-if="data.recent.length === 0" class="py-10 text-center text-xs text-ink-muted">هنوز مصرفی ثبت نشده است.</div>
          <div v-else class="mt-3 divide-y divide-line/70">
            <div v-for="item in data.recent" :key="item.id" class="flex items-center justify-between gap-3 py-3 text-xs">
              <div class="min-w-0">
                <p class="truncate font-medium text-ink">{{ item.modelName ?? 'مدل' }}</p>
                <p class="mt-1 text-ink-muted">{{ date(item.createdAt) }} · {{ format(item.totalTokens) }} توکن</p>
              </div>
              <span class="shrink-0 rounded-full bg-primary-soft px-2 py-1 text-primary">{{ format(item.chargedCredits) }} اعتبار</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
