<script setup lang="ts">
// پروفایل کاربر: آواتار jdenticon + اطلاعات حساب + ویرایش نام نمایشی
// و چرخش تصادفی آواتار (seed). با <dialog> بومی (مطابق الگوی ConfirmModal).
import { computed, reactive, ref, watch } from 'vue'
import { PhShuffle } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { ApiError } from '@/api/http'
import { updateMe } from '@/api/users'
import { useAuthStore } from '@/stores/auth'
import { avatarValueFor } from '@/utils/avatar'
import { validateDisplayName } from '@/utils/validation'
import { apiErrorMessage } from '@/utils/errors'
import { formatDateTime } from '@/utils/time'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const auth = useAuthStore()

const dialog = ref<HTMLDialogElement | null>(null)
const form = reactive({ displayName: '' })
/** پیش‌نمایش محلی seed؛ تا «ذخیره» فقط محلی است و با انصراف دور ریخته می‌شود. */
const seedPreview = ref<string | null>(null)
const fieldError = ref<string | null>(null)
const submitError = ref<{ message: string } | null>(null)
const saving = ref(false)

const previewValue = computed(() =>
  auth.user ? avatarValueFor({ id: auth.user.id, avatarSeed: seedPreview.value }) : '',
)

const seedChanged = computed(() => auth.user !== null && seedPreview.value !== auth.user.avatarSeed)

watch(
  () => props.open,
  (isOpen) => {
    const el = dialog.value
    if (isOpen) {
      form.displayName = auth.user?.displayName ?? ''
      seedPreview.value = auth.user?.avatarSeed ?? null
      fieldError.value = null
      submitError.value = null
      if (el && !el.open) el.showModal()
    } else if (el && el.open) {
      el.close()
    }
  },
)

function close(): void {
  if (saving.value) return
  emit('update:open', false)
}

function onDialogClose(): void {
  emit('update:open', false)
}

function onCancel(): void {
  if (saving.value) {
    emit('update:open', false)
    return
  }
  close()
}

function onRandomize(): void {
  seedPreview.value = crypto.randomUUID()
}

async function onSave(): Promise<void> {
  submitError.value = null
  fieldError.value = validateDisplayName(form.displayName)
  if (fieldError.value || !auth.user) return

  const body: { displayName: string; avatarSeed?: string } = {
    displayName: form.displayName.trim(),
  }
  if (seedChanged.value && seedPreview.value) body.avatarSeed = seedPreview.value

  saving.value = true
  try {
    const updated = await updateMe(body)
    auth.updateProfile(updated)
    emit('update:open', false)
  } catch (err) {
    if (err instanceof ApiError) {
      const field = err.fieldErrors.displayName
      if (field) fieldError.value = field
      else submitError.value = { message: apiErrorMessage(err) }
    } else {
      submitError.value = { message: 'ذخیره انجام نشد. لطفاً دوباره تلاش کنید.' }
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="mx-auto my-auto rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-bg/70"
    @close="onDialogClose"
    @cancel.prevent="onCancel"
  >
    <div v-if="auth.user" class="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-5 p-6">
      <header class="flex items-center gap-4">
        <span class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-elevated">
          <UserAvatar :value="previewValue" :size="64" />
        </span>
        <button
          type="button"
          class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          :aria-label="'آواتار تصادفی'"
          :title="'آواتار تصادفی'"
          @click="onRandomize"
        >
          <PhShuffle class="size-4.5" aria-hidden="true" />
        </button>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-base font-semibold">
            {{ auth.user.displayName || auth.user.username || 'حساب کاربری' }}
          </h2>
          <p class="mt-0.5 truncate text-sm text-ink-muted" dir="ltr">{{ auth.user.email }}</p>
        </div>
      </header>

      <ErrorBanner v-if="submitError" :message="submitError.message" />

      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-ink-muted">نام کاربری</dt>
        <dd class="truncate text-left" dir="ltr">{{ auth.user.username ?? '—' }}</dd>
        <dt class="text-ink-muted">نقش</dt>
        <dd>{{ auth.user.role === 'admin' ? 'مدیر' : 'کاربر' }}</dd>
        <dt class="text-ink-muted">عضویت از</dt>
        <dd>{{ formatDateTime(auth.user.createdAt) }}</dd>
      </dl>

      <BaseInput
        v-model="form.displayName"
        label="نام نمایشی"
        type="text"
        autocomplete="name"
        hint="حداکثر ۵۰ کاراکتر؛ خالی بگذارید تا حذف شود."
        :error="fieldError"
      />

      <footer class="flex items-center justify-end gap-2">
        <BaseButton variant="ghost" size="sm" :disabled="saving" @click="close">
          انصراف
        </BaseButton>
        <BaseButton size="sm" :loading="saving" @click="onSave">
          {{ saving ? 'در حال ذخیره…' : 'ذخیره' }}
        </BaseButton>
      </footer>
    </div>
  </dialog>
</template>
