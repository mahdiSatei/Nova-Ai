<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PhPlugsConnected } from '@phosphor-icons/vue'
import ProviderList from '@/components/admin/ProviderList.vue'
import ProviderForm from '@/components/admin/ProviderForm.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { listProviders } from '@/api/admin'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import type { ProviderAdmin } from '@/types/api'

const providers = ref<ProviderAdmin[]>([])
const loading = ref(true)
const loadError = ref<ApiError | null>(null)
const showCreateForm = ref(false)

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const { items } = await listProviders()
    providers.value = items
  } catch (err) {
    if (err instanceof ApiError) loadError.value = err
  } finally {
    loading.value = false
  }
}

onMounted(load)

function onSaved(): void {
  showCreateForm.value = false
  load()
}
</script>

<template>
  <section>
    <header class="mb-4 flex items-center gap-3">
      <PhPlugsConnected class="size-5 text-primary" aria-hidden="true" />
      <h1 class="text-base font-semibold">پیکربندی ارائه‌دهندگان</h1>
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

    <template v-else>
      <ProviderList
        :providers="providers"
        @create-provider="showCreateForm = true"
      />

      <div v-if="showCreateForm" class="mt-6">
        <ProviderForm @saved="onSaved" @cancel="showCreateForm = false" />
      </div>
    </template>
  </section>
</template>
