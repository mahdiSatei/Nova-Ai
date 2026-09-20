<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { PhTrash, PhCheck, PhX, PhPower, PhKey } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { listApiKeys, updateApiKey, deleteApiKey, validateApiKey } from '@/api/admin'
import type { ApiKeyAdmin } from '@/types/api'

const props = defineProps<{ providerId: string }>()

const keys = ref<ApiKeyAdmin[]>([])
const loading = ref(true)
const error = ref(false)

const editingId = ref<string | null>(null)
const editLabel = ref('')
const editApiKey = ref('')
const saving = ref(false)

const validatingId = ref<string | null>(null)
const validationResult = ref<{ keyId: string; success: boolean; message: string } | null>(null)

async function loadKeys(): Promise<void> {
  loading.value = true
  error.value = false
  try {
    keys.value = await listApiKeys(props.providerId)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

onMounted(loadKeys)

watch(() => props.providerId, loadKeys)

function startEdit(key: ApiKeyAdmin): void {
  editingId.value = key.id
  editLabel.value = key.label
  editApiKey.value = ''
}

function cancelEdit(): void {
  editingId.value = null
  editLabel.value = ''
  editApiKey.value = ''
}

async function saveEdit(keyId: string): Promise<void> {
  if (!editLabel.value.trim()) return

  saving.value = true
  try {
    const body: { label?: string; apiKey?: string } = {}
    if (editLabel.value.trim()) body.label = editLabel.value.trim()
    if (editApiKey.value.trim()) body.apiKey = editApiKey.value.trim()
    await updateApiKey(props.providerId, keyId, body)
    cancelEdit()
    await loadKeys()
  } catch {
    alert('خطا در ذخیره تغییرات')
  } finally {
    saving.value = false
  }
}

async function toggleActive(key: ApiKeyAdmin): Promise<void> {
  try {
    await updateApiKey(props.providerId, key.id, { isActive: !key.isActive })
    await loadKeys()
  } catch {
    alert('خطا در تغییر وضعیت')
  }
}

async function remove(keyId: string): Promise<void> {
  if (!confirm('آیا از حذف این کلید مطمئن هستید؟')) return
  try {
    await deleteApiKey(props.providerId, keyId)
    await loadKeys()
  } catch {
    alert('خطا در حذف کلید')
  }
}

async function validateKey(key: ApiKeyAdmin): Promise<void> {
  validatingId.value = key.id
  validationResult.value = null
  try {
    await validateApiKey(props.providerId, key.id)
    validationResult.value = { keyId: key.id, success: true, message: 'اعتبارسنجی موفق' }
    await loadKeys()
  } catch {
    validationResult.value = { keyId: key.id, success: false, message: 'خطا در اعتبارسنجی' }
  } finally {
    validatingId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-ink">کلیدهای API</h3>
    </div>

    <div v-if="loading" class="h-20 animate-pulse rounded bg-surface" />

    <div v-else-if="error" class="text-sm text-danger">
      خطا در بارگذاری کلیدها
    </div>

    <p v-else-if="keys.length === 0" class="text-xs text-ink-muted">
      هنوز کلید API اضافه نشده است.
    </p>

    <div v-else class="flex flex-col gap-2">
      <div
        v-for="key in keys"
        :key="key.id"
        class="flex items-center gap-3 rounded-lg border border-line p-3"
      >
        <template v-if="editingId === key.id">
          <div class="flex-1 flex flex-col gap-2">
            <BaseInput v-model="editLabel" label="برچسب" dir="ltr" />
            <BaseInput
              v-model="editApiKey"
              label="کلید جدید (خالی بگذارید برای حفظ فعلی)"
              type="password"
              dir="ltr"
            />
          </div>
          <div class="flex gap-1">
            <BaseButton variant="ghost" size="sm" type="button" @click="cancelEdit">
              <PhX class="size-4" />
            </BaseButton>
            <BaseButton size="sm" type="button" :loading="saving" @click="saveEdit(key.id)">
              <PhCheck class="size-4" />
            </BaseButton>
          </div>
        </template>

        <template v-else>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm">{{ key.label }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="key.isActive ? 'bg-success/15 text-success' : 'bg-line text-ink-muted'"
              >
                {{ key.isActive ? 'فعال' : 'غیرفعال' }}
              </span>
            </div>
            <div class="text-xs text-ink-muted mt-1">
              <span v-if="key.lastValidatedAt">آخرین اعتبارسنجی: {{ key.lastValidatedAt }}</span>
              <span v-else>اعتبارسنجی نشده</span>
              <span v-if="key.failureCount > 0"> · خطاها: {{ key.failureCount }}</span>
            </div>
            <div
              v-if="validationResult && validationResult.keyId === key.id"
              class="text-xs mt-1"
              :class="validationResult.success ? 'text-success' : 'text-danger'"
            >
              {{ validationResult.message }}
            </div>
          </div>
          <div class="flex gap-1">
            <BaseButton
              variant="ghost"
              size="sm"
              type="button"
              title="اعتبارسنجی کلید"
              :loading="validatingId === key.id"
              @click="validateKey(key)"
            >
              <PhKey class="size-4" :class="key.lastValidatedAt ? 'text-success' : 'text-ink-muted'" />
            </BaseButton>
            <BaseButton
              variant="ghost"
              size="sm"
              type="button"
              :title="key.isActive ? 'غیرفعال کردن' : 'فعال کردن'"
              @click="toggleActive(key)"
            >
              <PhPower v-if="key.isActive" class="size-4 text-success" />
              <PhPower v-else class="size-4 text-ink-muted" />
            </BaseButton>
            <BaseButton variant="ghost" size="sm" type="button" @click="startEdit(key)">
              <span class="text-xs">ویرایش</span>
            </BaseButton>
            <BaseButton
              variant="ghost"
              size="sm"
              type="button"
              class="text-danger hover:text-danger"
              @click="remove(key.id)"
            >
              <PhTrash class="size-4" />
            </BaseButton>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>