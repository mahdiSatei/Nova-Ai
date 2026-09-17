<script setup lang="ts">
// لیست ترنسکریپت: پیام‌های قطعی + پیام کاربر pending + بافر در حال استریم.
// هر ردیف با ChatMessage رندر می‌شود (Markdown برای دستیار، حباب برای کاربر).
import { computed } from 'vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import type { MessagePublic, MessageStatus } from '@/types/api'

type GenerationStatus = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled'

const props = defineProps<{
  messages: MessagePublic[]
  pendingUser?: MessagePublic | null
  streamingText?: string
  isStreaming?: boolean
  /** Active generation for recovery UI */
  generation?: { conversationId: string; assistantMessageId: string; status: GenerationStatus; content: string } | null
  onRetry?: (failedMessageId: string) => void
  onReconnect?: () => void
  onCancel?: () => void
}>()

interface Row {
  key: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string | null
  streaming: boolean
  pending: boolean
  status: MessageStatus
  showRecovery: boolean
  recoveryStatus: GenerationStatus | null
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
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      streaming: isActiveStreaming,
      pending: false,
      status: m.status,
      showRecovery: streamNeedsRecovery || m.status === 'failed' || m.status === 'cancelled',
      recoveryStatus: m.status as GenerationStatus,
    })
  }

  if (props.pendingUser) {
    out.push({
      key: props.pendingUser.id,
      role: 'user',
      content: props.pendingUser.content,
      createdAt: props.pendingUser.createdAt,
      streaming: false,
      pending: Boolean(props.isStreaming),
      status: 'completed',
      showRecovery: false,
      recoveryStatus: null,
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
      role: 'assistant',
      content: props.generation.content,
      createdAt: null,
      streaming: true,
      pending: false,
      status: 'streaming',
      showRecovery: false,
      recoveryStatus: null,
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
      :role="row.role"
      :content="row.content"
      :created-at="row.createdAt"
      :streaming="row.streaming"
      :pending="row.pending"
      :status="row.status"
      :show-recovery="row.showRecovery"
      :recovery-status="row.recoveryStatus"
      :on-retry="onRetry"
      :on-reconnect="onReconnect"
      :on-cancel="onCancel"
    />
  </ol>
</template>
