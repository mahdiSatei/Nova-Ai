<script setup lang="ts">
import { PhShieldWarning } from '@phosphor-icons/vue'
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
    <PhShieldWarning class="size-12 text-danger" aria-hidden="true" />
    <h1 class="text-xl font-semibold">دسترسی غیرمجاز</h1>
    <p class="max-w-sm text-sm text-ink-muted">
      حساب شما اجازه دسترسی به این صفحه را ندارد.
    </p>
    <RouterLink
      to="/chat"
      class="inline-flex cursor-pointer items-center justify-center rounded-lg border border-line bg-elevated px-4 py-2.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-line"
    >
      بازگشت به گفتگو
    </RouterLink>
  </main>
</template>
