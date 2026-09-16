<script setup lang="ts">
// یک ردیف پیام:
// - کاربر: حباب متمایز در ابتدای سطر (در RTL: سمت راست) با avatar کوچک.
// - دستیار: avatar روی ستون مقابل + متن Markdown تقریباً تمام‌عرض که با
//   پس‌زمینه ترکیب می‌شود (سبک Claude/ChatGPT).
// - pending (در حال ارسال) و streaming (caret + نقطه‌های پران) همین‌جا.
// - recovery actions for failed/cancelled/streaming messages.
import { ref } from 'vue'
import { PhRobot, PhUserCircle, PhCopy, PhCheck, PhHourglassMedium, PhWarning, PhArrowsClockwise, PhStop } from '@phosphor-icons/vue'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import TypingIndicator from '@/components/chat/TypingIndicator.vue'
import { copyText } from '@/utils/clipboard'
import { formatDateTime } from '@/utils/time'
import type { MessageStatus } from '@/types/api'

const props = withDefaults(
  defineProps<{
    role: 'user' | 'assistant'
    content: string
    createdAt?: string | null
    streaming?: boolean
    pending?: boolean
    status?: MessageStatus
    showRecovery?: boolean
    recoveryStatus?: MessageStatus
    onRetry?: (failedMessageId: string) => void
    onReconnect?: () => void
    onCancel?: () => void
  }>(),
  { createdAt: null, streaming: false, pending: false, status: 'completed', showRecovery: false },
)

const isUser = props.role === 'user'

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
      class="flex size-8 shrink-0 select-none items-center justify-center self-start rounded-full"
      :class="
        isUser
          ? 'border border-line bg-elevated text-ink-muted'
          : 'bg-gradient-to-br from-primary to-accent/70 text-white shadow-sm'
      "
      aria-hidden="true"
    >
      <PhUserCircle v-if="isUser" class="size-5" />
      <PhRobot v-else class="size-4" />
    </div>

    <!-- ستون محتوا -->
    <div
      class="flex min-w-0 flex-col gap-1"
      :class="isUser ? 'items-start max-w-[min(42rem,85%)]' : 'w-0 flex-1 items-stretch'"
    >
      <!-- بدنه -->
      <div
        v-if="isUser"
        class="rounded-2xl rounded-ss-md bg-elevated px-4 py-2.5 text-sm leading-relaxed text-ink shadow-sm"
      >
        <span class="whitespace-pre-wrap">{{ content }}</span>
      </div>
      <div v-else class="min-w-0 py-0.5 text-ink">
        <MarkdownRenderer :source="content" :streaming="streaming" />
        <TypingIndicator v-if="streaming && !content" />
      </div>

      <!-- فوتر: زمان / وضعیت / کپی / اقدامات بازیابی -->
      <footer
        class="flex items-center gap-2 px-1 text-[11px] text-ink-muted/70"
        :class="{ 'flex-row-reverse': !isUser }"
      >
        <template v-if="pending">
          <PhHourglassMedium class="size-3 animate-pulse" aria-hidden="true" />
          <span>در حال ارسال…</span>
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
              @click="onRetry(content)"
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
              @click="onRetry(content)"
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
