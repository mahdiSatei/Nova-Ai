<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PhRobot,
  PhCopy,
  PhCheck,
  PhHourglassMedium,
  PhFile,
  PhFilePdf,
  PhFileXls,
  PhImage,
  PhWarning,
  PhArrowsClockwise,
  PhStop,
} from '@phosphor-icons/vue'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { copyText } from '@/utils/clipboard'
import { formatDateTime } from '@/utils/time'
import { avatarValueFor } from '@/utils/avatar'
import { formatFileSize } from '@/api/files'
import { useAuthStore } from '@/stores/auth'
import type { MessagePublic, MessageStatus } from '@/types/api'

const props = withDefaults(
  defineProps<{
    role: 'user' | 'assistant'
    /** Real message id, used to target retry on the correct failed row. */
    messageId?: string
    content: string
    createdAt?: string | null
    streaming?: boolean
    pending?: boolean
    file?: MessagePublic['file'] | null
    status?: MessageStatus
    showRecovery?: boolean
    recoveryStatus?: MessageStatus
    onRetry?: (failedMessageId: string) => void
    onReconnect?: () => void
    onCancel?: () => void
  }>(),
  {
    createdAt: null,
    streaming: false,
    pending: false,
    file: null,
    status: 'completed',
    showRecovery: false,
  },
)

const isUser = props.role === 'user'

const auth = useAuthStore()
const userAvatarValue = computed(() =>
  auth.user ? avatarValueFor(auth.user) : 'anonymous',
)

const copied = ref(false)

function onCopy(): void {
  void copyText(props.content).then((ok) => {
    if (!ok) return
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1600)
  })
}
</script>

<template>
  <li class="group flex animate-fade-slide-in gap-2.5 sm:gap-3" :class="{ 'flex-row-reverse': !isUser }">
    <!-- avatar -->
    <div
      class="flex size-8 shrink-0 select-none items-center justify-center self-start overflow-hidden rounded-full"
      :class="
        isUser
          ? 'border border-line bg-elevated'
          : 'bg-gradient-to-br from-primary to-accent/70 text-white shadow-sm'
      "
      aria-hidden="true"
    >
      <UserAvatar v-if="isUser" :value="userAvatarValue" :size="30" />
      <PhRobot v-else class="size-4" />
    </div>

    <!-- ستون محتوا -->
    <div
      class="flex min-w-0 flex-col gap-1"
      :class="isUser ? 'items-start max-w-[min(42rem,85%)]' : 'w-0 flex-1 items-stretch'"
    >
      <!-- بدنه پیام کاربر -->
      <div
        v-if="isUser"
        class="flex flex-col gap-2 rounded-2xl rounded-ss-md bg-elevated px-4 py-2.5 text-sm leading-relaxed text-ink shadow-sm"
      >
        <!-- ✨ کارت فایل پیوست شده بالای متن پیام -->
        <div
          v-if="file"
          class="flex items-center gap-2.5 rounded-xl border border-line bg-surface/80 px-3 py-2 text-xs shadow-xs"
        >
          <span class="text-primary shrink-0">
            <PhFilePdf v-if="file.mimeType?.includes('pdf')" class="size-5" />
            <PhFileXls v-else-if="file.mimeType?.includes('sheet') || file.mimeType?.includes('excel')" class="size-5" />
            <PhImage v-else-if="file.mimeType?.includes('image')" class="size-5" />
            <PhFile v-else class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <bdi dir="auto" class="block truncate font-medium text-ink">{{ file.originalName }}</bdi>
            <span class="text-[11px] text-ink-muted/80">{{ formatFileSize(file.size) }}</span>
          </div>
        </div>

        <span dir="auto" class="whitespace-pre-wrap">{{ content }}</span>
      </div>

      <!-- بدنه پیام هوش مصنوعی -->
      <div v-else class="min-w-0 py-0.5 text-ink">
        <MarkdownRenderer :source="content" :streaming="streaming" />
      </div>

      <!-- فوتر: زمان / وضعیت / کپی / اقدامات بازیابی -->
      <footer
        class="flex items-center gap-2 px-1 text-[11px] text-ink-muted/70"
        :class="{ 'flex-row-reverse': !isUser }"
      >
        <template v-if="pending">
        </template>
        <template v-else-if="streaming">
          <span class="flex items-end gap-1" aria-hidden="true">
            <i class="size-1 animate-typing-bounce rounded-full bg-primary [animation-delay:0ms]" />
            <i class="size-1 animate-typing-bounce rounded-full bg-primary [animation-delay:150ms]" />
            <i class="size-1 animate-typing-bounce rounded-full bg-primary [animation-delay:300ms]" />
          </span>
          <span>در حال تولید پاسخ…</span>
        </template>
        <template v-else>
          <span v-if="createdAt" class="font-mono">{{ formatDateTime(createdAt) }}</span>
          <button
            v-if="!isUser"
            type="button"
            class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
            aria-label="کپی پاسخ"
            @click="onCopy"
          >
            <PhCheck v-if="copied" class="size-3 text-success" aria-hidden="true" />
            <PhCopy v-else class="size-3" aria-hidden="true" />
            <span>{{ copied ? 'کپی شد' : 'کپی' }}</span>
          </button>
        </template>

        <!-- Recovery actions for non-completed messages -->
        <template v-if="showRecovery && !isUser">
          <!-- Streaming: reconnect -->
          <template v-if="recoveryStatus === 'streaming'">
            <span class="flex items-center gap-1 text-warning">
              <PhWarning class="size-3" aria-hidden="true" />
              <span>اتصال قطع شد</span>
            </span>
            <button
              v-if="onReconnect"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-primary hover:bg-primary-soft"
              @click="onReconnect"
            >
              <PhArrowsClockwise class="size-3" aria-hidden="true" />
              <span>اتصال مجدد</span>
            </button>
          </template>
          <!-- Failed: retry -->
          <template v-if="recoveryStatus === 'failed'">
            <span class="flex items-center gap-1 text-danger">
              <PhWarning class="size-3" aria-hidden="true" />
              <span>خطا در تولید پاسخ</span>
            </span>
            <button
              v-if="onRetry"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-primary hover:bg-primary-soft"
              @click="onRetry(messageId ?? content)"
            >
              <PhArrowsClockwise class="size-3" aria-hidden="true" />
              <span>تلاش مجدد</span>
            </button>
          </template>
          <!-- Cancelled: retry -->
          <template v-if="recoveryStatus === 'cancelled'">
            <span class="flex items-center gap-1 text-ink-muted">
              <PhStop class="size-3" aria-hidden="true" />
              <span>تولید پاسخ متوقف شد</span>
            </span>
            <button
              v-if="onRetry"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-primary hover:bg-primary-soft"
              @click="onRetry(messageId ?? content)"
            >
              <PhArrowsClockwise class="size-3" aria-hidden="true" />
              <span>تلاش مجدد</span>
            </button>
          </template>
        </template>
      </footer>
    </div>
  </li>
</template>