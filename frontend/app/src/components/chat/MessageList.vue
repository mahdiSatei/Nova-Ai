<script setup lang="ts">
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
  recoveryStatus: MessageStatus | null
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
      recoveryStatus: m.status as MessageStatus,
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
      :on-retry="onRetry"
      :on-reconnect="onReconnect"
      :on-cancel="onCancel"
    />
  </ol>
</template>