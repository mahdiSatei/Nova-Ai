<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PhPlugsConnected } from '@phosphor-icons/vue'
import ProviderForm from '@/components/admin/ProviderForm.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { getProvider } from '@/api/admin'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import type { CentralProviderPublic } from '@/types/api'

const provider = ref<CentralProviderPublic | null>(null)
const loading = ref(true)
const loadError = ref<ApiError | null>(null)

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    provider.value = await getProvider()
  } catch (err) {
    if (err instanceof ApiError) loadError.value = err
  } finally {
    loading.value = false
  }
}

onMounted(load)

function onSaved(next: CentralProviderPublic): void {
  provider.value = next
}
</script>

<template>
  <section>
    <header class="mb-4 flex items-center gap-3">
      <PhPlugsConnected class="size-5 text-primary" aria-hidden="true" />
      <h1 class="text-base font-semibold">پیکربندی ارائه‌دهنده</h1>
    </header>

    <div v-if="loading" class="h-48 animate-pulse rounded-card bg-surface" />

    <div v-else-if="loadError" class="flex flex-col gap-3">
      <ErrorBanner
        :message="apiErrorMessage(loadError)"
        :code="loadError.code"
        :request-id="loadError.requestId"
        :show-code="true"
      />
      <button class="self-start text-sm text-primary hover:underline" @click="load">تلاش مجدد</button>
    </div>

    <ProviderForm
      v-else
      :provider="provider"
      @saved="onSaved"
    />

    <p v-if="provider?.isConfigured" class="mt-4 text-xs text-ink-muted/70">
      کلید API به‌صورت رمزگذاری‌شده ذخیره می‌شود. در بازخوانی‌های بعدی فقط شکل ماسک‌شده نمایش داده می‌شود.
    </p>
  </section>
</template>
