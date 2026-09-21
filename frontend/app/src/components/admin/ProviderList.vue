<script setup lang="ts">
import { ref } from 'vue'
import { PhPencilSimple, PhPlus, PhCheckCircle, PhToggleLeft, PhXCircle, PhTrash, PhX } from '@phosphor-icons/vue'
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

// سیستم Toast/Alert شناور
const activeAlert = ref<{ id: string; success: boolean; message: string } | null>(null)
let alertTimer: ReturnType<typeof setTimeout> | null = null

async function testConnection(provider: ProviderAdmin): Promise<void> {
  testingId.value = provider.id
  try {
    await validateProvider(provider.id)
    showAlert(provider.id, true, `ارتباط با ارائه‌دهنده «${provider.name}» با موفقیت برقرار شد.`)
  } catch {
    showAlert(provider.id, false, `خطا در برقراری ارتباط با ارائه‌دهنده «${provider.name}».`)
  } finally {
    testingId.value = null
  }
}

function showAlert(id: string, success: boolean, message: string) {
  if (alertTimer) clearTimeout(alertTimer)
  activeAlert.value = { id, success, message }
  
  // خودبه‌خود بعد از 5 ثانیه محو شود
  alertTimer = setTimeout(() => {
    activeAlert.value = null
  }, 5000)
}

function closeAlert() {
  if (alertTimer) clearTimeout(alertTimer)
  activeAlert.value = null
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
  <div class="relative">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-medium text-ink">ارائه‌دهندگان</h2>
      <button
        class="flex items-center gap-1 text-sm text-primary hover:underline cursor-pointer"
        @click="emit('create-provider')"
      >
        <PhPlus class="size-4" />
        افزودن ارائه‌دهنده
      </button>
    </div>

    <!-- جدول ساده و تمیز بدون به‌هم‌ریختگی -->
    <div class="max-h-[32rem] overflow-auto rounded-card border border-line bg-surface">
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
          <tr v-for="provider in providers" :key="provider.id" class="border-b border-line last:border-b-0 transition-colors hover:bg-elevated/30">
            <td class="px-4 py-3 font-medium text-ink">{{ provider.name }}</td>
            <td class="px-4 py-3 font-mono text-xs text-ink-muted">{{ provider.baseUrl }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2.5 py-0.5 text-xs font-medium"
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
        </tbody>
      </table>
    </div>

    <!-- بنر/آلرت شناور (Toast) در گوشه صفحه -->
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="activeAlert"
        class="fixed bottom-6 end-6 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur-md"
        :class="
          activeAlert.success
            ? 'border-success/40 bg-success/15 text-success'
            : 'border-danger/40 bg-danger-soft text-danger'
        "
      >
        <component
          :is="activeAlert.success ? PhCheckCircle : PhXCircle"
          class="size-5 shrink-0"
        />
        <span class="font-medium">{{ activeAlert.message }}</span>
        <button
          type="button"
          class="ms-2 rounded-lg p-1 opacity-70 hover:opacity-100 transition"
          @click="closeAlert"
        >
          <PhX class="size-4" />
        </button>
      </div>
    </Transition>

    <p v-if="providers.length === 0" class="text-sm text-ink-muted text-center py-4">
      هنوز ارائه‌دهنده‌ای پیکربندی نشده است.
    </p>
  </div>
</template>