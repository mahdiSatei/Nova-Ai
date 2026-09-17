<script setup lang="ts">
// طبق BR-017 / §7.5: پیام انسانی همیشه نمایش داده می‌شود؛ کد پایدار و
// requestId فقط زمانی که consumer صریحاً درخواست کند (برای support).
// در حالت پیش‌فرض پاک است — برای جلوگیری از نشت اطلاعات در خطاهای
// احراز هویت و سایر خطاهای قابل انتظار.
import { PhWarningCircle } from '@phosphor-icons/vue'

withDefaults(
  defineProps<{
    message: string
    code?: string
    requestId?: string
    /** نمایش کد خطا و requestId (برای support). پیش‌فرض: مخفی. */
    showCode?: boolean
  }>(),
  { showCode: false },
)
</script>

<template>
  <div
    role="alert"
    class="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3"
  >
    <PhWarningCircle class="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <p class="text-sm text-ink">{{ message }}</p>
      <!-- طبق BR-017: کد و requestId برای پشتیبانی در دسترس‌اند، ولی پشت
           دیسکلوز پنهان می‌مانند تا پیام انسانی تنها چیزِ برجسته باشد. -->
      <details v-if="showCode && (code || requestId)" class="mt-1.5">
        <summary
          class="w-fit cursor-pointer list-none rounded-md px-1 text-[11px] text-ink-muted/70 transition-colors hover:text-ink focus-visible:text-ink"
        >
          جزئیات فنی
        </summary>
        <p class="mt-1 font-mono text-xs text-ink-muted/70" dir="ltr">
          <span v-if="code">{{ code }}</span>
          <span v-if="code && requestId"> · </span>
          <span v-if="requestId">{{ requestId }}</span>
        </p>
      </details>
    </div>
  </div>
</template>

