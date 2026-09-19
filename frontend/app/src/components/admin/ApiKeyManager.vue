<script setup lang="ts">
// فاز ۸+ — مدیریت کلیدهای API چندگانه برای یک ارائه‌دهنده.
import { ref, onMounted, watch } from 'vue'
import { PhPlus, PhTrash, PhCheck, PhX } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { listApiKeys, addApiKey, updateApiKey, deleteApiKey, validateApiKey, type ApiKeyAdmin } from '@/api/admin'

const props = defineProps<{ providerId: string }>()

const keys = ref<ApiKeyAdmin[]>([])
const loading = ref(true)
const error = ref<ApiError | null>(null)

// New key form
const showAddForm = ref(false)
const newLabel = ref('')
const newApiKey = ref('')
const adding = ref(false)
const addError = ref<string | null>(null)

// Edit state
const editingId = ref<string | null>(null)
const editLabel = ref('')
const editApiKey = ref('')
const saving = ref(false)

// Validation state
const validatingId = ref<string | null>(null)
const validationResult = ref<{ keyId: string; success: boolean; message: string } | null>(null)

async function loadKeys(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    keys.value = await listApiKeys(props.providerId)
  } catch (err) {
    if (err instanceof ApiError) error.value = err
  } finally {
    loading.value = false
  }
}

onMounted(loadKeys)

// Reload when provider changes
watch(() => props.providerId, loadKeys)

async function onAdd(): Promise<void> {
  if (!newLabel.value.trim()) {
    addError.value = 'برچسب الزامی است.'
    return
  }
  if (!newApiKey.value.trim()) {
    addError.value = 'کلید API الزامی است.'
    return
  }

  adding.value = true
  addError.value = null
  try {
    await addApiKey(props.providerId, {
      label: newLabel.value.trim(),
      apiKey: newApiKey.value.trim(),
      isActive: true,
    })
    newLabel.value = ''
    newApiKey.value = ''
    showAddForm.value = false
    await loadKeys()
  } catch (err) {
    if (err instanceof ApiError) {
      addError.value = apiErrorMessage(err)
    } else {
      addError.value = 'خطایی رخ داد.'
    }
  } finally {
    adding.value = false
  }
}

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
  } catch (err) {
    if (err instanceof ApiError) {
      alert(apiErrorMessage(err))
    }
  } finally {
    saving.value = false
  }
}

async function toggleActive(key: ApiKeyAdmin): Promise<void> {
  try {
    await updateApiKey(props.providerId, key.id, { isActive: !key.isActive })
    await loadKeys()
  } catch (err) {
    if (err instanceof ApiError) {
      alert(apiErrorMessage(err))
    }
  }
}

async function remove(keyId: string): Promise<void> {
  if (!confirm('آیا از حذف این کلید مطمئن هستید؟')) return
  try {
    await deleteApiKey(props.providerId, keyId)
    await loadKeys()
  } catch (err) {
    if (err instanceof ApiError) {
      alert(apiErrorMessage(err))
    }
  }
}

async function validateKey(key: ApiKeyAdmin): Promise<void> {
  validatingId.value = key.id
  validationResult.value = null
  try {
    await validateApiKey(props.providerId, key.id)
    validationResult.value = { keyId: key.id, success: true, message: 'اعتبارسنجی موفق' }
    await loadKeys() // Refresh to get updated lastValidatedAt
  } catch (err) {
    const message = err instanceof ApiError ? apiErrorMessage(err) : 'خطا در اعتبارسنجی'
    validationResult.value = { keyId: key.id, success: false, message }
  } finally {
    validatingId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-ink">کلیدهای API</h3>
      <BaseButton
        variant="ghost"
        size="sm"
        type="button"
        @click="showAddForm = !showAddForm"
      >
        <PhPlus class="size-4" aria-hidden="true" />
        <span>{{ showAddForm ? 'انصراف' : 'افزودن کلید' }}</span>
      </BaseButton>
    </div>

    <!-- Add new key form -->
    <div
      v-if="showAddForm"
      class="flex flex-col gap-2 rounded-lg border border-line p-3"
    >
      <BaseInput
        v-model="newLabel"
        label="برچسب"
        placeholder="مثلاً: Production, Backup"
        dir="ltr"
      />
      <BaseInput
        v-model="newApiKey"
        label="کلید API"
        type="password"
        dir="ltr"
      />
      <ErrorBanner v-if="addError" :message="addError" class="mb-2" />
      <div class="flex justify-end gap-2">
        <BaseButton variant="ghost" size="sm" type="button" @click="showAddForm = false">
          انصراف
        </BaseButton>
        <BaseButton type="button" :loading="adding" @click="onAdd">
          ذخیره
        </BaseButton>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="h-20 animate-pulse rounded bg-surface" />

    <!-- Error state -->
    <ErrorBanner v-else-if="error" :message="apiErrorMessage(error)" />

    <!-- Empty state -->
    <p v-else-if="keys.length === 0" class="text-xs text-ink-muted">
      هنوز کلید API اضافه نشده است.
    </p>

    <!-- Keys list -->
    <div v-else class="flex flex-col gap-2">
      <div
        v-for="key in keys"
        :key="key.id"
        class="flex items-center gap-3 rounded-lg border border-line p-3"
      >
        <!-- Edit mode -->
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

        <!-- View mode -->
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
              v-if="validationResult?.keyId === key.id"
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
              <PhCheck class="size-4" :class="key.lastValidatedAt ? 'text-success' : 'text-ink-muted'" />
            </BaseButton>
            <BaseButton
              variant="ghost"
              size="sm"
              type="button"
              :title="key.isActive ? 'غیرفعال کردن' : 'فعال کردن'"
              @click="toggleActive(key)"
            >
              <PhCheck v-if="key.isActive" class="size-4 text-success" />
              <PhX v-else class="size-4 text-ink-muted" />
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
