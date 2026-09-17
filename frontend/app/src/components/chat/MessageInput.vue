<script setup lang="ts">
// ورودی شناور پایین صفحه: textarea خوداِندازه، Enter ارسال / Shift+Enter خط جدید.
// دکمه هنگام استریم به «توقف» تبدیل می‌شود (رویداد stop). منطق ارسال دست ChatView است.
// پیوست فایل: دکمه گیره + drag&drop + چیپ پیش‌نمایش؛ آپلود فوراً انجام می‌شود
// و شناسه فایل از طریق `fileId` در اختیار والد قرار می‌گیرد.
import { computed, nextTick, ref, watch } from 'vue'
import { PhArrowUp, PhStop, PhPaperclip, PhX, PhFile } from '@phosphor-icons/vue'
import { formatFileSize, uploadFile, validateLocalFile, type UploadedFile } from '@/api/files'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    disabled?: boolean
    busy?: boolean
  }>(),
  { placeholder: 'پیام خود را بنویسید…', disabled: false, busy: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  stop: []
  fileUploaded: [file: UploadedFile | null]
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

// پیوست فایل
const uploading = ref(false)
const uploadedFile = ref<UploadedFile | null>(null)
const uploadError = ref<string | null>(null)
const isDragging = ref(false)

const canSend = computed(
  () => !props.disabled && !props.busy && !uploading.value && props.modelValue.trim().length > 0,
)

function autoResize(): void {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`
}

watch(() => props.modelValue, () => nextTick(autoResize), { immediate: true })

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (canSend.value) emit('submit')
  }
}

function onSubmitClick(): void {
  if (props.busy) {
    emit('stop')
    return
  }
  if (canSend.value) emit('submit')
}

function openFilePicker(): void {
  if (props.disabled || uploading.value) return
  fileInput.value?.click()
}

function clearFile(): void {
  uploadedFile.value = null
  uploadError.value = null
  if (fileInput.value) fileInput.value.value = ''
  emit('fileUploaded', null)
}

async function handleFile(file: File | undefined): Promise<void> {
  if (!file || props.disabled || uploading.value) return
  uploadError.value = null
  try {
    validateLocalFile(file)
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : 'فایل نامعتبر است.'
    if (fileInput.value) fileInput.value.value = ''
    return
  }

  uploading.value = true
  try {
    uploadedFile.value = await uploadFile(file)
    emit('fileUploaded', uploadedFile.value)
  } catch (err) {
    uploadError.value = err instanceof Error && err.message ? err.message : 'آپلود فایل ناموفق بود.'
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function onFileChosen(e: Event): void {
  const input = e.target as HTMLInputElement
  void handleFile(input.files?.[0])
}

function onDragOver(e: DragEvent): void {
  if (props.disabled) return
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave(e: DragEvent): void {
  e.preventDefault()
  isDragging.value = false
}

function onDrop(e: DragEvent): void {
  e.preventDefault()
  isDragging.value = false
  void handleFile(e.dataTransfer?.files?.[0])
}
</script>

<template>
  <form @submit.prevent="onSubmitClick">
    <!-- خطای اعتبارسنجی/آپلود -->
    <p v-if="uploadError" class="mb-1.5 px-2 text-xs text-warning">
      {{ uploadError }}
    </p>

    <!-- چیپ فایل پیوست‌شده / در حال آپلود -->
    <div
      v-if="uploadedFile || uploading"
      class="mb-1.5 mx-1 flex w-fit max-w-full items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-1.5 text-xs shadow-sm"
    >
      <PhFile class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span v-if="uploading" class="truncate text-ink-muted">در حال آپلود فایل…</span>
      <template v-else-if="uploadedFile">
        <span class="truncate font-medium text-ink">{{ uploadedFile.originalName }}</span>
        <span class="shrink-0 text-ink-muted/70">{{ formatFileSize(uploadedFile.size) }}</span>
      </template>
      <button
        type="button"
        class="shrink-0 cursor-pointer rounded-full p-0.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        aria-label="حذف فایل پیوست"
        @click="clearFile"
      >
        <PhX class="size-3.5" aria-hidden="true" />
      </button>
    </div>

    <div
      class="flex items-end gap-2 rounded-[1.4rem] border bg-surface p-2 shadow-lg transition-[border-color,box-shadow,background-color] duration-200"
      :class="[
        isDragging
          ? 'border-primary bg-primary-soft shadow-(--app-shadow)'
          : disabled || busy
            ? 'border-line/70 shadow-(--app-shadow)'
            : 'border-line focus-within:border-primary/60 focus-within:shadow-(--app-shadow) focus-within:shadow-xl',
      ]"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg"
        class="hidden"
        aria-hidden="true"
        tabindex="-1"
        @change="onFileChosen"
      />
      <button
        type="button"
        class="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        :class="{ 'animate-pulse text-primary': uploading }"
        :disabled="disabled || uploading"
        :aria-label="uploading ? 'در حال آپلود فایل' : 'پیوست فایل'"
        @click="openFilePicker"
      >
        <PhPaperclip class="size-4" aria-hidden="true" />
      </button>
      <textarea
        ref="textarea"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        rows="1"
        dir="rtl"
        class="max-h-56 min-h-9 flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-sm leading-6 text-ink placeholder:text-ink-muted/60 focus:outline-none disabled:cursor-not-allowed"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="submit"
        :disabled="!busy && !canSend"
        :aria-label="busy ? 'توقف تولید پاسخ' : 'ارسال پیام'"
        class="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all duration-150 disabled:cursor-not-allowed"
        :class="[
          busy
            ? 'bg-ink text-bg hover:opacity-80'
            : canSend
              ? 'bg-primary text-on-primary shadow-sm hover:bg-primary-hover'
              : 'bg-elevated text-ink-muted/60',
        ]"
      >
        <PhStop v-if="busy" class="size-4 fill-current" aria-hidden="true" />
        <PhArrowUp v-else class="size-[18px] font-bold" aria-hidden="true" weight="bold" />
      </button>
    </div>
    <p class="mt-2 hidden text-center text-[11px] text-ink-muted/60 sm:block">
      Enter ارسال · Shift+Enter خط جدید · فایل را اینجا رها کنید
    </p>
  </form>
</template>
