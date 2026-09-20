<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PhRobot,
  PhCopy,
  PhCheck,
  PhFile,
  PhFilePdf,
  PhFileXls,
  PhImage,
  PhWarning,
  PhArrowsClockwise,
  PhStop,
  PhBrain,
} from '@phosphor-icons/vue'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import SearchActivity from '@/components/chat/SearchActivity.vue'
import SourceCitations from '@/components/chat/SourceCitations.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { copyText } from '@/utils/clipboard'
import { formatDateTime } from '@/utils/time'
import { avatarValueFor } from '@/utils/avatar'
import { formatFileSize } from '@/api/files'
import { useAuthStore } from '@/stores/auth'
import type { CitationSource, MessagePublic, MessageStatus, SearchPhase } from '@/types/api'

const props = withDefaults(
  defineProps<{
    role: 'user' | 'assistant'
    messageId?: string
    content: string
    createdAt?: string | null
    streaming?: boolean
    pending?: boolean
    file?: MessagePublic['file'] | null
    status?: MessageStatus
    showRecovery?: boolean
    recoveryStatus?: MessageStatus | 'idle' | null
    /** فاز ۷ — منابع وبِ استنادشده. */
    citations?: CitationSource[]
    /** فاز ۷ — پیشرفت جستجو/بازیابی حین نسخه‌برداری. */
    searchActivity?: {
      phase: SearchPhase
      query?: string
      sources?: number
      credits?: number
    } | null
    /** فاز ۸ — استدلال برای این پیام فعال بوده است. */
    reasoningEnabled?: boolean
    /** فاز ۸ — سرور تأیید کرده که استدلال در جریان است. */
    reasoningActive?: boolean
    /** فاز ۸ — استدلال این نوبت به پایان رسیده است. */
    reasoningCompleted?: boolean
    /** فاز ۸ — خلاصهٔ استدلال (در حال استریم یا ذخیره‌شده). */
    reasoningSummary?: string | null
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
    reasoningEnabled: false,
    reasoningActive: false,
    reasoningCompleted: false,
    reasoningSummary: null,
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
  <!-- کانتینر اصلی پیام با خط جداکننده زیر پاسخ مدل -->
  <li 
    class="group flex flex-col animate-fade-slide-in py-4 w-full"
    :class="{ 'border-b border-line/40 pb-6 mb-2': !isUser }"
  >
    <!-- تاریخ کوچک بالای پیام کاربر -->
    <div v-if="isUser && createdAt" class="flex w-full justify-center my-1">
      <span class="text-[10px] font-mono text-ink-muted/60 bg-elevated px-2 py-0.5 rounded-full">
        {{ formatDateTime(createdAt) }}
      </span>
    </div>

    <!-- خط اصلی چت (آواتار و متن) -->
    <div class="flex gap-3 w-full" :class="{ 'flex-row-reverse': isUser }">
      
      <!-- 👤 آواتار (برای کاربر و مدل به صورت یکدست) -->
      <div
        class="flex size-8 shrink-0 select-none items-center justify-center self-start overflow-hidden rounded-full mt-0.5"
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

      <!-- 💬 ستون محتوا (متن پیام + فوتر) -->
      <div
        class="flex min-w-0 flex-col gap-1"
        :class="isUser ? 'items-end max-w-[min(42rem,85%)]' : 'flex-1 items-stretch'"
      >
        <!-- بدنه پیام کاربر -->
        <div
          v-if="isUser"
          class="flex flex-col gap-2 rounded-2xl rounded-se-sm bg-elevated px-4 py-2.5 text-sm leading-relaxed text-ink shadow-sm w-full text-right"
        >
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
            <div class="min-w-0 flex-1 text-right">
              <bdi dir="auto" class="block truncate font-medium text-ink">{{ file.originalName }}</bdi>
              <span class="text-[11px] text-ink-muted/80">{{ formatFileSize(file.size) }}</span>
            </div>
          </div>

          <span dir="auto" class="whitespace-pre-wrap">{{ content }}</span>
        </div>

        <!-- بدنه پیام هوش مصنوعی -->
        <div v-else class="min-w-0 py-0.5 text-ink">
          <MarkdownRenderer :source="content" :streaming="streaming" />

          <!-- فاز ۸ — پانل استدلال مدل -->
          <ReasoningPanel
            v-if="reasoningSummary"
            :summary="reasoningSummary"
            :streaming="streaming || reasoningActive"
          />

          <p
            v-else-if="reasoningActive"
            class="mt-2 flex items-center gap-1.5 px-1 text-xs text-ink-muted"
            role="status"
            aria-live="polite"
          >
            <PhBrain class="size-3.5 animate-pulse text-primary" aria-hidden="true" />
            <span>در حال استدلال…</span>
          </p>

          <p
            v-else-if="reasoningEnabled && reasoningCompleted"
            class="mt-2 flex items-center gap-1.5 px-1 text-xs text-ink-muted"
            role="status"
            aria-live="polite"
          >
            <PhBrain class="size-3.5 text-ink-muted" aria-hidden="true" />
            <span>استدلال فعال بود؛ این مدل محتوایی برای نمایش ارائه نکرد.</span>
          </p>

          <!-- فاز ۷ — پیشرفت جستجو و فهرست منابع -->
          <SearchActivity
            v-if="searchActivity && streaming"
            :activity="searchActivity"
          />

          <SourceCitations
            v-if="citations?.length"
            :sources="citations"
          />
        </div>

        <!-- فوتر: دکمه کپی و حالت‌های استریم/خطا -->
        <footer
          class="flex items-center gap-2 px-1 text-[11px] text-ink-muted/70 mt-1"
          :class="{ 'flex-row-reverse': isUser }"
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
            <!-- تاریخ برای بات یا دکمه کپی -->
            <span v-if="!isUser && createdAt" class="font-mono">
              {{ formatDateTime(createdAt) }}
            </span>

            <!-- دکمه کپی -->
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
              :aria-label="isUser ? 'کپی پرامپت' : 'کپی پاسخ'"
              @click="onCopy"
            >
              <PhCheck v-if="copied" class="size-3 text-success" aria-hidden="true" />
              <PhCopy v-else class="size-3" aria-hidden="true" />
              <span>{{ copied ? 'کپی شد' : 'کپی' }}</span>
            </button>
          </template>

          <!-- Recovery actions -->
          <template v-if="showRecovery && !isUser">
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

    </div>
  </li>
</template>