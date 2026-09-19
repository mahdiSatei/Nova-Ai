<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  PhArrowUp,
  PhStop,
  PhPaperclip,
  PhX,
  PhFile,
  PhCheckCircle,
  PhWarningCircle,
  PhSpinnerGap,
} from '@phosphor-icons/vue'
import {
  formatFileSize,
  getFileStatus,
  uploadFile,
  validateLocalFile,
  type UploadedFile,
} from '@/api/files'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    disabled?: boolean
    busy?: boolean
    attachment?: UploadedFile | null
  }>(),
  { placeholder: 'پیام خود را بنویسید…', disabled: false, busy: false, attachment: null },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:attachment': [value: UploadedFile | null]
  submit: []
  stop: []
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

// وضعیت‌های آپلود و پردازش
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const isDragging = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const attachment = computed(() => props.attachment)
const hasAttachment = computed(() => attachment.value !== null || uploading.value)

// دکمه ارسال فقط زمانی فعال است که فایل در صورت وجود READY شده باشد
const canSend = computed(
  () =>
    !props.disabled &&
    !props.busy &&
    !uploading.value &&
    (!attachment.value || attachment.value.status === 'READY') &&
    props.modelValue.trim().length > 0,
)

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPollingStatus(fileId: string): void {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const res = await getFileStatus(fileId)
      if (props.attachment && props.attachment.id === fileId) {
        props.attachment.status = res.status
        if (res.errorMessage) {
          props.attachment.errorMessage = res.errorMessage
        }
        // اگر پردازش تمام شد یا خطا داد، پولینگ متوقف شود
        if (res.status === 'READY' || res.status === 'FAILED') {
          stopPolling()
        }
      } else {
        stopPolling()
      }
    } catch {
      stopPolling()
    }
  }, 1000)
}

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
  stopPolling()
  uploadError.value = null
  if (fileInput.value) fileInput.value.value = ''
  emit('update:attachment', null)
}

async function handleFile(file: File | undefined): Promise<void> {
  if (!file || props.disabled || uploading.value) return
  stopPolling()
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
    const uploaded = await uploadFile(file)
    emit('update:attachment', uploaded)
    // شروع رصد لحظه‌ای وضعیت در صف
    startPollingStatus(uploaded.id)
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

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<template>
  <form @submit.prevent="onSubmitClick">
    <!-- خطای اعتبارسنجی اولیه -->
    <p v-if="uploadError" class="mb-1.5 px-2 text-xs text-warning">
      {{ uploadError }}
    </p>

    <!-- چیپ فایل پیوست‌شده با وضعیت‌های مختلف -->
    <div
      v-if="hasAttachment"
      class="mb-1.5 mx-1 flex w-fit max-w-full items-center gap-2 rounded-xl border bg-elevated px-3 py-1.5 text-xs shadow-sm transition-colors duration-200"
      :class="{
        'border-line': !attachment || attachment.status === 'READY',
        'border-primary/50 bg-primary-soft': attachment && (attachment.status === 'PROCESSING' || attachment.status === 'UPLOADED'),
        'border-danger/50 bg-danger/10 text-danger': attachment && attachment.status === 'FAILED',
      }"
    >
      <PhFile class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      
      <!-- در حال آپلود شبکه -->
      <span v-if="uploading" class="truncate text-ink-muted">در حال آپلود فایل…</span>
      
      <template v-else-if="attachment">
        <bdi dir="auto" class="truncate font-medium text-ink">{{ attachment.originalName }}</bdi>
        <span class="shrink-0 text-ink-muted/70">({{ formatFileSize(attachment.size) }})</span>

        <!-- وضعیت: در حال استخراج متن -->
        <span
          v-if="attachment.status === 'PROCESSING' || attachment.status === 'UPLOADED'"
          class="flex items-center gap-1 text-primary shrink-0 font-medium"
        >
          <PhSpinnerGap class="size-3.5 animate-spin" aria-hidden="true" />
          <span>در حال پردازش…</span>
        </span>

        <!-- وضعیت: آماده برای ارسال -->
        <span
          v-else-if="attachment.status === 'READY'"
          class="flex items-center gap-1 text-success shrink-0 font-medium"
        >
          <PhCheckCircle class="size-3.5" aria-hidden="true" />
          <span>آماده ارسال</span>
        </span>

        <!-- وضعیت: خطا در پردازش -->
        <span
          v-else-if="attachment.status === 'FAILED'"
          class="flex items-center gap-1 text-danger shrink-0 font-medium"
          :title="attachment.errorMessage || 'خطا در پردازش'"
        >
          <PhWarningCircle class="size-3.5" aria-hidden="true" />
          <span>{{ attachment.errorMessage ? attachment.errorMessage : 'خطا در پردازش' }}</span>
        </span>
      </template>

      <!-- دکمه حذف پیوست -->
      <button
        type="button"
        class="shrink-0 cursor-pointer rounded-full p-0.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        aria-label="حذف فایل پیوست"
        @click="clearFile"
      >
        <PhX class="size-3.5" aria-hidden="true" />
      </button>
    </div>

    <!-- اینپوت چت -->
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