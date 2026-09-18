<script setup lang="ts">
// یک ردیف گفتگو: عنوان + پین/حذف (با هاور نمایان می‌شوند).
import { PhChatsCircle, PhPushPin, PhTrash } from '@phosphor-icons/vue'
import type { ConversationSummary } from '@/types/api'

defineProps<{
  conversation: ConversationSummary
  active: boolean
  pinBusy: boolean
}>()

defineEmits<{
  open: [id: string]
  togglePin: [conversation: ConversationSummary]
  remove: [id: string]
}>()
</script>

<template>
  <div
    class="group relative flex h-9 items-center overflow-hidden rounded-lg transition-colors"
    :class="active ? 'bg-primary-soft' : 'hover:bg-hover'"
  >
    <button
      type="button"
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-start text-[13px] transition-colors"
      :class="active ? 'font-medium text-primary' : 'text-ink-muted group-hover:text-ink'"
      :title="conversation.title?.trim() || 'بدون عنوان'"
      @click="$emit('open', conversation.id)"
    >
      <PhChatsCircle class="size-4 shrink-0" aria-hidden="true" />
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate">{{ conversation.title?.trim() || 'بدون عنوان' }}</span>
        <span
          v-if="conversation.modelDisplayName"
          class="truncate text-[11px] text-ink-muted/80"
        >{{ conversation.modelDisplayName }}</span>
      </span>
    </button>
    <div class="flex shrink-0 items-center">
      <button
        type="button"
        class="size-7 inline-flex cursor-pointer items-center justify-center rounded-md transition-[color,background-color,opacity] focus-visible:opacity-100 max-lg:opacity-100"
        :class="
          conversation.pinned
            ? 'opacity-100 text-primary'
            : 'opacity-0 group-hover:opacity-100 text-ink-muted/70 hover:text-ink'
        "
        :aria-label="conversation.pinned ? 'برداشتن پین گفتگو' : 'پین کردن گفتگو'"
        :title="conversation.pinned ? 'برداشتن پین' : 'پین کردن'"
        :disabled="pinBusy"
        @click="$emit('togglePin', conversation)"
      >
        <PhPushPin class="size-3.5" :weight="conversation.pinned ? 'fill' : 'regular'" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="size-7 inline-flex cursor-pointer items-center justify-center rounded-md opacity-0 text-ink-muted/70 transition-[color,background-color,opacity] group-hover:opacity-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 max-lg:opacity-100"
        aria-label="حذف گفتگو"
        title="حذف گفتگو"
        @click="$emit('remove', conversation.id)"
      >
        <PhTrash class="size-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
