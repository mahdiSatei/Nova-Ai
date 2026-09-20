<script setup lang="ts">
import { computed } from 'vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import type { CitationSource, MessagePublic, MessageStatus, SearchPhase } from '@/types/api'

type GenerationStatus = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled'

const props = defineProps<{
  messages: MessagePublic[]
  pendingUser?: MessagePublic | null
  streamingText?: string
  isStreaming?: boolean
  /** Active generation for recovery UI */
  generation?: { conversationId: string; assistantMessageId: string; status: GenerationStatus; content: string; citations?: CitationSource[] } | null
  /** فاز ۷ — پیشرفت جستجو/بازیابی. */
  searchActivity?: { phase: SearchPhase; query?: string; sources?: number; credits?: number } | null
  /** فاز ۸ — استدلال در جریان (فقط برای ردیف در حال استریم). */
  reasoningActive?: boolean
  /** فاز ۸ — استدلال این نوبت تمام شده است (فقط برای ردیف در حال استریم). */
  reasoningCompleted?: boolean
  /** فاز ۸ — خلاصهٔ استدلال دریافتی در همین نوبت. */
  reasoningSummary?: string
  onRetry?: (failedMessageId: string) => void
  onReconnect?: () => void
  onCancel?: () => void
}>()

interface Row {
  key: string
  /** Real message id when the row comes from the transcript (undefined for synthetic rows). */
  messageId?: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string | null
  streaming: boolean
  pending: boolean
  file?: MessagePublic['file'] | null
  status: MessageStatus
  showRecovery: boolean
  recoveryStatus: GenerationStatus | null
  citations?: CitationSource[]
  /** فاز ۸ — استدلال این ردیف فعال بوده است. */
  reasoningEnabled: boolean
  /** فاز ۸ — استدلال این نوبت به پایان رسیده است. */
  reasoningCompleted: boolean
  /** فاز ۸ — خلاصهٔ استدلال این ردیف (ذخیره‌شده یا در حال استریم). */
  reasoningSummary: string | null
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []

  for (const m of props.messages) {
    const isActiveStreaming = m.status === 'streaming'
    // A streaming message only needs recovery UI when there is no active
    // generation running. If generation.status is 'streaming', the resume
    // succeeded and the stream is flowing normally — show streaming dots
    // instead of the "connection lost" recovery banner.
    const streamNeedsRecovery = isActiveStreaming && props.generation?.status !== 'streaming'
    out.push({
      key: m.id,
      messageId: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      streaming: isActiveStreaming,
      pending: false,
      file: m.file, // ✨ فایل پیوست پیام
      status: m.status,
      showRecovery: streamNeedsRecovery || m.status === 'failed' || m.status === 'cancelled',
      recoveryStatus: m.status as GenerationStatus,
      citations: m.citations,
      // A persisted turn that reasoned but produced no user-visible summary is
      // still worth labelling, so "reasoning was on" is never silently lost.
      reasoningEnabled: (m as any).reasoningEnabled ?? false,
      reasoningCompleted: Boolean((m as any).reasoningEnabled && !(m as any).reasoningSummary),
      reasoningSummary: (m as any).reasoningSummary ?? null,
    })
  }

  if (props.pendingUser) {
    out.push({
      key: props.pendingUser.id,
      messageId: props.pendingUser.id,
      role: 'user',
      content: props.pendingUser.content,
      createdAt: props.pendingUser.createdAt,
      streaming: false,
      pending: Boolean(props.isStreaming),
      file: props.pendingUser.file, // ✨ فایل پیوست پیام موقت
      status: 'completed',
      showRecovery: false,
      recoveryStatus: null,
      reasoningEnabled: false,
      reasoningCompleted: false,
      reasoningSummary: null,
    })
  }

  // Fallback: if transcript has no assistant message but generation is active,
  // render the streaming response from generation.value.content.
  if (
    props.generation?.status === 'streaming' &&
    !out.some((r) => r.status === 'streaming')
  ) {
    out.push({
      key: props.generation.assistantMessageId || 'streaming',
      messageId: props.generation.assistantMessageId || undefined,
      role: 'assistant',
      content: props.generation.content,
      createdAt: null,
      streaming: true,
      pending: false,
      status: 'streaming',
      showRecovery: false,
      recoveryStatus: null,
      citations: props.generation?.citations,
      // The synthetic row only exists while a generation is running, so the
      // live reasoning state belongs to it.
      reasoningEnabled: true,
      reasoningCompleted: Boolean(props.reasoningCompleted),
      reasoningSummary: props.reasoningSummary ?? null,
    })
  }

  return out
})
</script>

<template>
  <ol class="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6" role="log" aria-live="polite">
    <ChatMessage
      v-for="row in rows"
      :key="row.key"
      :message-id="row.messageId"
      :role="row.role"
      :content="row.content"
      :created-at="row.createdAt"
      :streaming="row.streaming"
      :pending="row.pending"
      :file="row.file"
      :status="row.status"
      :show-recovery="row.showRecovery"
      :recovery-status="row.recoveryStatus"
      :citations="row.citations"
      :search-activity="row.streaming ? searchActivity : null"
      :reasoning-enabled="row.reasoningEnabled"
      :reasoning-active="row.streaming ? Boolean(reasoningActive) : false"
      :reasoning-completed="row.reasoningCompleted"
      :reasoning-summary="row.streaming ? reasoningSummary ?? null : row.reasoningSummary"
      :on-retry="onRetry"
      :on-reconnect="onReconnect"
      :on-cancel="onCancel"
    />
  </ol>
</template>