<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCheckCircle, PhXCircle, PhSpinner } from '@phosphor-icons/vue'

const route = useRoute()
const router = useRouter()

const status = computed(() => (route.query.status as string) ?? 'unknown')

const statusConfig = computed(() => {
  switch (status.value) {
    case 'success':
      return {
        icon: PhCheckCircle,
        color: 'text-success',
        bg: 'bg-success-soft',
        title: 'پرداخت موفق',
        message: 'اعتبار شما به کیف پول اضافه شد.',
      }
    case 'failed':
      return {
        icon: PhXCircle,
        color: 'text-danger',
        bg: 'bg-danger-soft',
        title: 'پرداخت ناموفق',
        message: 'پرداخت با خطا مواجه شد. لطفاً دوباره تلاش کنید.',
      }
    case 'cancelled':
      return {
        icon: PhXCircle,
        color: 'text-warning',
        bg: 'bg-warning-soft',
        title: 'پرداخت لغو شده',
        message: 'پرداخت لغو شد.',
      }
    case 'pending':
      return {
        icon: PhSpinner,
        color: 'text-accent',
        bg: 'bg-accent/10',
        title: 'در حال بررسی',
        message: 'پرداخت شما در حال بررسی است. لطفاً صبر کنید.',
      }
    default:
      return {
        icon: PhXCircle,
        color: 'text-ink-muted',
        bg: 'bg-elevated',
        title: 'وضعیت نامشخص',
        message: 'وضعیت پرداخت قابل تشخیص نیست.',
      }
  }
})
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center">
      <span
        class="mx-auto flex size-16 items-center justify-center rounded-full"
        :class="statusConfig.bg"
      >
        <component :is="statusConfig.icon" class="size-8" :class="statusConfig.color" />
      </span>

      <h1 class="mt-4 text-lg font-semibold text-ink">{{ statusConfig.title }}</h1>
      <p class="mt-2 text-sm text-ink-muted">{{ statusConfig.message }}</p>

      <button
        type="button"
        class="mt-6 rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90"
        @click="router.push('/chat/wallet')"
      >
        بازگشت به کیف پول
      </button>
    </div>
  </div>
</template>
