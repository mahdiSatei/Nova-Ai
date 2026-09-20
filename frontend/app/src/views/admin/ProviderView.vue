<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PhPlugsConnected } from '@phosphor-icons/vue'
import ProviderList from '@/components/admin/ProviderList.vue'
import ProviderFormModal from '@/components/admin/ProviderFormModal.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { listProviders, deleteProvider } from '@/api/admin'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import type { ProviderAdmin } from '@/types/api'

const providers = ref<ProviderAdmin[]>([])
const loading = ref(true)
const loadError = ref<ApiError | null>(null)
const showForm = ref(false)
const editingProvider = ref<ProviderAdmin | null>(null)

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

function openCreate(): void {
  editingProvider.value = null
  showForm.value = true
}

function openEdit(provider: ProviderAdmin): void {
  editingProvider.value = provider
  showForm.value = true
}

async function onDelete(provider: ProviderAdmin): Promise<void> {
  if (!confirm(`آیا از حذف ${provider.name} مطمئن هستید؟`)) return
  try {
    await deleteProvider(provider.id)
    await load()
  } catch (err) {
    if (err instanceof ApiError) {
      alert(apiErrorMessage(err))
    }
  }
}

function onSaved(): void {
  showForm.value = false
  editingProvider.value = null
  load()
}
</script>

<template>
  <section>
    <header class="mb-4 flex items-center gap-3">
      <PhPlugsConnected class="size-5 text-primary" aria-hidden="true" />
      <div>
        <h1 class="text-base font-semibold">پیکربندی ارائه‌دهندگان</h1>
        <p class="mt-1 text-xs text-ink-muted">ارائه‌دهندگان مدل، کلیدهای اتصال و وضعیت دسترسی به سرویس‌ها را مدیریت کنید.</p>
      </div>
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
        @create-provider="openCreate"
        @edit-provider="openEdit"
        @delete-provider="onDelete"
        @refresh="load"
      />

      <ProviderFormModal
        v-model:open="showForm"
        :provider="editingProvider"
        @saved="onSaved"
      />
    </template>
  </section>
</template>
