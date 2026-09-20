<script setup lang="ts">
import { ref } from 'vue'
import { PhPencilSimple, PhPlus, PhCheckCircle, PhToggleLeft, PhXCircle, PhTrash } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { updateProvider, validateProvider } from '@/api/admin'
import type { ProviderAdmin } from '@/types/api'

defineProps<{
  providers: ProviderAdmin[]
}>()

const emit = defineEmits<{
  'create-provider': []
  'edit-provider': [provider: ProviderAdmin]
  'delete-provider': [provider: ProviderAdmin]
  'refresh': []
}>()

const testingId = ref<string | null>(null)
const togglingId = ref<string | null>(null)
const testResults = ref<Record<string, { success: boolean; message: string }>>({})

async function testConnection(provider: ProviderAdmin): Promise<void> {
  testingId.value = provider.id
  delete testResults.value[provider.id]
  try {
    await validateProvider(provider.id)
    testResults.value[provider.id] = { success: true, message: 'اتصال موفق' }
  } catch {
    testResults.value[provider.id] = { success: false, message: 'خطا در اتصال' }
  } finally {
    testingId.value = null
  }
}

async function toggleActive(provider: ProviderAdmin): Promise<void> {
  togglingId.value = provider.id
  try {
    await updateProvider(provider.id, { isActive: !provider.isActive })
    emit('refresh')
  } catch {
  } finally {
    togglingId.value = null
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-medium text-ink">ارائه‌دهندگان</h2>
      <button
        class="flex items-center gap-1 text-sm text-primary hover:underline"
        @click="emit('create-provider')"
      >
        <PhPlus class="size-4" />
        افزودن ارائه‌دهنده
      </button>
    </div>

    <div class="overflow-x-auto rounded-card border border-line bg-surface">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line bg-elevated/40 text-xs uppercase tracking-wide text-ink-muted">
            <th class="px-4 py-2.5 text-start font-medium">نام</th>
            <th class="px-4 py-2.5 text-start font-medium">آدرس پایه</th>
            <th class="px-4 py-2.5 text-start font-medium">وضعیت</th>
            <th class="px-4 py-2.5 text-end font-medium">عملیات</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="provider in providers" :key="provider.id">
            <tr class="border-b border-line last:border-b-0 transition-colors hover:bg-elevated/30">
              <td class="px-4 py-3 font-medium text-ink">{{ provider.name }}</td>
              <td class="px-4 py-3 font-mono text-xs text-ink-muted">{{ provider.baseUrl }}</td>
              <td class="px-4 py-3">
                <span
                  class="rounded-full px-2.5 py-0.5 text-xs"
                  :class="provider.isActive ? 'bg-success/15 text-success' : 'bg-line text-ink-muted'"
                >
                  {{ provider.isActive ? 'فعال' : 'غیرفعال' }}
                </span>
              </td>
              <td class="px-4 py-3 text-end">
                <div class="inline-flex items-center gap-1">
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    :aria-label="'تست اتصال'"
                    :title="'تست اتصال'"
                    :loading="testingId === provider.id"
                    @click="testConnection(provider)"
                  >
                    <PhCheckCircle class="size-4" aria-hidden="true" />
                  </BaseButton>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    :aria-label="provider.isActive ? 'غیرفعال کردن' : 'فعال کردن'"
                    :title="provider.isActive ? 'غیرفعال کردن' : 'فعال کردن'"
                    :loading="togglingId === provider.id"
                    @click="toggleActive(provider)"
                  >
                    <PhToggleLeft
                      class="size-4"
                      :class="provider.isActive ? 'text-success' : 'text-ink-muted'"
                      aria-hidden="true"
                    />
                  </BaseButton>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    :aria-label="'حذف'"
                    class="text-ink-muted hover:text-danger"
                    @click="emit('delete-provider', provider)"
                  >
                    <PhTrash class="size-4" aria-hidden="true" />
                  </BaseButton>
                  <BaseButton variant="ghost" size="sm" :aria-label="'ویرایش'" @click="emit('edit-provider', provider)">
                    <PhPencilSimple class="size-4" aria-hidden="true" />
                  </BaseButton>
                </div>
              </td>
            </tr>
            <tr v-if="testResults[provider.id]" class="border-b border-line last:border-b-0">
              <td colspan="4" class="px-4 py-2">
                <div
                  class="flex items-center gap-1.5 text-xs"
                  :class="testResults[provider.id].success ? 'text-success' : 'text-danger'"
                >
                  <PhCheckCircle v-if="testResults[provider.id].success" class="size-3.5" />
                  <PhXCircle v-else class="size-3.5" />
                  {{ testResults[provider.id].message }}
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-if="providers.length === 0" class="text-sm text-ink-muted text-center py-4">
      هنوز ارائه‌دهنده‌ای پیکربندی نشده است.
    </p>
  </div>
</template>
