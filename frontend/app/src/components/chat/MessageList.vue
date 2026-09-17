<script setup lang="ts">
// لیست ترنسکریپت: پیام‌های قطعی + پیام کاربر pending + بافر در حال استریم.
// هر ردیف با ChatMessage رندر می‌شود (Markdown برای دستیار، حباب برای کاربر).
import { computed } from 'vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import type { MessagePublic } from '@/types/api'

const props = defineProps<{
  messages: MessagePublic[]
  pendingUser?: MessagePublic | null
  streamingText?: string
  isStreaming?: boolean
}>()

interface Row {
  key: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string | null
  streaming: boolean
  pending: boolean
}

const rows = computed<Row[]>(() => {
  const out: Row[] = props.messages.map((m) => ({
    key: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    streaming: false,
    pending: false,
  }))
  if (props.pendingUser) {
    out.push({
      key: props.pendingUser.id,
      role: 'user',
      content: props.pendingUser.content,
      createdAt: props.pendingUser.createdAt,
      streaming: false,
      pending: Boolean(props.isStreaming),
    })
  }
  if (props.streamingText || props.isStreaming) {
    out.push({
      key: 'streaming',
      role: 'assistant',
      content: props.streamingText ?? '',
      createdAt: null,
      streaming: Boolean(props.isStreaming),
      pending: false,
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
    />
  </ol>
</template>
