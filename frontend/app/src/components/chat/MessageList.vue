<script setup lang="ts">
// رندر ترنسکریپت گفتگو با تمرکز بر AI-Native:
// - پیام‌های کاربر: bubble سمت راست (RTL mirror)، رنگ elevated
// - پیام‌های assistant: ستون اصلی با avatar و bubble خط‌دار
// - streaming (فعال): bubble موقت با cursor چشمک‌زن + فوتر spinner «در حال تولید پاسخ…»
// - streaming (پایان یافته ولی هنوز optimistic): bubble بدون cursor + timestamp
// - خط زمانی کنار هر پیام
import { computed } from 'vue'
import { PhUserCircle, PhRobot, PhCircleNotch } from '@phosphor-icons/vue'
import { formatDateTime } from '@/utils/time'
import type { MessagePublic } from '@/types/api'

const props = defineProps<{
  messages: MessagePublic[]
  pendingUser?: MessagePublic | null
  streamingText?: string
  isStreaming?: boolean
  streamCompletedAt?: string | null
}>()

const items = computed(() => {
  const out: Array<
    | { kind: 'message'; msg: MessagePublic }
    | { kind: 'pending-user'; msg: MessagePublic }
    | { kind: 'streaming'; text: string }
  > = []
  for (const m of props.messages) out.push({ kind: 'message', msg: m })
  if (props.pendingUser) out.push({ kind: 'pending-user', msg: props.pendingUser })
  if (props.streamingText) out.push({ kind: 'streaming', text: props.streamingText })
  return out
})
</script>

<template>
  <ol class="flex flex-col gap-5 py-5" role="log" aria-live="polite">
    <li
      v-for="(item, idx) in items"
      :key="item.kind === 'message' ? item.msg.id : `${item.kind}-${idx}`"
      class="flex gap-3"
      :class="{
        // در RTL: کاربر در سمت راست صفحه (default flex-row)، دستیار در سمت چپ (flex-row-reverse).
        'flex-row-reverse': item.kind === 'streaming' || (item.kind === 'message' && item.msg.role === 'assistant'),
      }"
    >
      <!-- avatar -->
      <div
        class="flex size-8 shrink-0 items-center justify-center rounded-full border"
        :class="
          item.kind === 'message' && item.msg.role === 'user' || item.kind === 'pending-user'
            ? 'border-line bg-elevated text-ink-muted'
            : 'border-primary/30 bg-primary/15 text-primary'
        "
        aria-hidden="true"
      >
        <PhUserCircle v-if="item.kind === 'message' && item.msg.role === 'user'" class="size-4" />
        <PhUserCircle v-else-if="item.kind === 'pending-user'" class="size-4" />
        <PhRobot v-else class="size-4" />
      </div>

      <!-- ستون متن -->
      <div
        class="flex min-w-0 max-w-[85%] flex-col gap-1.5"
        :class="{
          // در RTL: items-end در ستون به معنای align به سمت چپ ستون است (flex-end).
          'items-end': item.kind === 'streaming' || (item.kind === 'message' && item.msg.role === 'assistant'),
        }"
      >
        <!-- bubble -->
        <div
          class="relative whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
          :class="
            item.kind === 'message' && item.msg.role === 'user' || item.kind === 'pending-user'
              ? 'bg-elevated text-ink'
              : 'border border-line/70 bg-surface text-ink'
          "
        >
          <!-- streaming: متن + (cursor فقط وقتی فعال است) -->
          <template v-if="item.kind === 'streaming'">
            <span>{{ item.text }}</span>
            <span
              v-if="isStreaming"
              class="ms-0.5 inline-block h-3 w-1.5 translate-y-0.5 rounded-sm bg-primary align-middle animate-pulse-dot"
              aria-hidden="true"
            />
          </template>
          <template v-else>
            {{ item.msg.content }}
          </template>
        </div>

        <!-- فوتر: در حالت streaming فعال spinner نشان داده می‌شود؛ پس از پایان، timestamp -->
        <footer
          class="flex items-center gap-1.5 px-1 text-[11px] text-ink-muted/70"
          :class="{
            'flex-row-reverse': item.kind === 'streaming' || (item.kind === 'message' && item.msg.role === 'assistant'),
          }"
        >
          <template v-if="item.kind === 'streaming'">
            <template v-if="isStreaming">
              <PhCircleNotch class="size-3 animate-spin" aria-hidden="true" />
              <span>در حال تولید پاسخ…</span>
            </template>
            <template v-else-if="streamCompletedAt">
              <span class="font-mono">{{ formatDateTime(streamCompletedAt) }}</span>
            </template>
          </template>
          <template v-else-if="item.kind === 'pending-user'">
            <span>در حال ارسال…</span>
          </template>
          <template v-else>
            <span class="font-mono">{{ formatDateTime(item.msg.createdAt) }}</span>
          </template>
        </footer>
      </div>
    </li>
  </ol>
</template>
