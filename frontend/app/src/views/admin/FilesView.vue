<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { listAdminFiles, type AdminFileRecord } from '@/api/admin'
import { formatFileSize } from '@/api/files'
import { formatDateTime } from '@/utils/time'
import { PhFile, PhWarning, PhCheckCircle, PhHourglass, PhArrowsClockwise, PhCaretRight, PhCaretLeft } from '@phosphor-icons/vue'

const files = ref<AdminFileRecord[]>([])
const loading = ref(true)
const errorMessage = ref<string | null>(null)

// Pagination state
const pageSize = 5
const currentPage = ref(1)

const paginatedFiles = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return files.value.slice(start, start + pageSize)
})

const totalPages = computed(() => Math.ceil(files.value.length / pageSize) || 1)

// تابع کوتاه کردن هوشمند نام فایل (حفظ پسوند)
function truncateFilename(name: string, maxLen = 22): string {
  if (name.length <= maxLen) return name
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return name.slice(0, maxLen) + '...'
  
  const ext = name.slice(dotIndex)
  const base = name.slice(0, dotIndex)
  const charsToShow = maxLen - ext.length - 3
  if (charsToShow <= 0) return name.slice(0, maxLen) + '...'
  
  return base.slice(0, charsToShow) + '...' + ext
}

async function loadFiles() {
  loading.value = true
  errorMessage.value = null
  try {
    files.value = await listAdminFiles(100, 0)
  } catch (err: any) {
    errorMessage.value = err?.message || 'خطا در بارگذاری لیست فایل‌ها.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadFiles()
})
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6" dir="rtl">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-ink">مدیریت فایل‌های پیوست</h1>
        <p class="text-sm text-ink-muted">مشاهده وضعیت پردازش، استخراج متن و خطاهای فایل‌های آپلود شده کاربران.</p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-sm font-medium text-ink hover:bg-hover transition cursor-pointer"
        @click="loadFiles"
      >
        <PhArrowsClockwise class="size-4" :class="{ 'animate-spin': loading }" />
        <span>بروزرسانی</span>
      </button>
    </div>

    <!-- ارور در صورت بروز مشکل -->
    <div v-if="errorMessage" class="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      {{ errorMessage }}
    </div>

    <!-- جدول فایل‌ها -->
    <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <table class="w-full border-collapse text-right">
        <thead>
          <tr class="border-b border-line bg-elevated text-xs font-semibold text-ink-muted">
            <th class="p-3.5 text-right w-1/4">نام فایل</th>
            <th class="p-3.5 text-right w-1/6">نوع (MimeType)</th>
            <th class="p-3.5 text-right w-20">حجم</th>
            <th class="p-3.5 text-right w-28">کاربر (شناسه)</th>
            <th class="p-3.5 text-right w-1/4">وضعیت پردازش</th>
            <th class="p-3.5 text-right w-36">تاریخ آپلود</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line text-sm text-ink">
          <tr v-if="loading && files.length === 0">
            <td colspan="6" class="p-8 text-center text-ink-muted">در حال بارگذاری فایل‌ها...</td>
          </tr>
          <tr v-else-if="files.length === 0">
            <td colspan="6" class="p-8 text-center text-ink-muted">هیچ فایلی هنوز آپلود نشده است.</td>
          </tr>
          <tr v-for="file in paginatedFiles" :key="file.id" class="hover:bg-hover/55 transition">
            <td class="p-3.5 font-medium">
              <div class="flex items-center gap-2">
                <PhFile class="size-4 text-primary shrink-0" />
                <span class="truncate" :title="file.originalName">{{ truncateFilename(file.originalName) }}</span>
              </div>
            </td>
            <td class="p-3.5 font-mono text-xs text-ink-muted">{{ file.mimeType }}</td>
            <td class="p-3.5 text-xs">{{ formatFileSize(file.size) }}</td>
            <td class="p-3.5 font-mono text-xs text-ink-muted truncate" :title="file.userId">
              {{ file.userId.slice(0, 8) }}...
            </td>
            <td class="p-3.5">
              <div class="flex flex-col gap-1 items-start">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="{
                    'bg-success-soft text-success': file.status?.toUpperCase() === 'READY',
                    'bg-warning-soft text-warning': file.status?.toUpperCase() === 'PROCESSING' || file.status?.toUpperCase() === 'UPLOADED',
                    'bg-danger-soft text-danger': file.status?.toUpperCase() === 'FAILED',
                  }"
                >
                  <PhCheckCircle v-if="file.status?.toUpperCase() === 'READY'" class="size-3.5" />
                  <PhHourglass v-else-if="file.status?.toUpperCase() === 'PROCESSING' || file.status?.toUpperCase() === 'UPLOADED'" class="size-3.5 animate-pulse" />
                  <PhWarning v-else-if="file.status?.toUpperCase() === 'FAILED'" class="size-3.5" />
                  
                  <span>
                    {{
                      file.status?.toUpperCase() === 'READY' ? 'آماده (Ready)' :
                      file.status?.toUpperCase() === 'PROCESSING' ? 'در حال پردازش (Processing)' :
                      file.status?.toUpperCase() === 'UPLOADED' ? 'آپلود شده (Uploaded)' : 'خطا (Failed)'
                    }}
                  </span>
                </span>
                
                <span v-if="file.errorMessage" class="text-[11px] text-danger max-w-xs truncate" :title="file.errorMessage">
                  خطا: {{ file.errorMessage }}
                </span>
              </div>
            </td>
            <td class="p-3.5 text-xs text-ink-muted font-mono">{{ formatDateTime(file.createdAt) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- نوار صفحه‌بندی (Pagination) -->
      <div v-if="files.length > pageSize" class="flex items-center justify-between border-t border-line bg-elevated/50 px-4 py-3 text-sm">
        <span class="text-xs text-ink-muted">
          نمایش صفحه {{ currentPage }} از {{ totalPages }} (مجموعاً {{ files.length }} فایل)
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            :disabled="currentPage === 1"
            @click="currentPage--"
          >
            <PhCaretRight class="size-3.5" />
            <span>قبلی</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            :disabled="currentPage >= totalPages"
            @click="currentPage++"
          >
            <span>بعدی</span>
            <PhCaretLeft class="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>