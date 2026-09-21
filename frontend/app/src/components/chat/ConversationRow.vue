<script setup lang="ts">
// یک ردیف گفتگو: عنوان + پین/حذف (با هاور نمایان می‌شوند).
import { ref } from 'vue'
import { PhChatsCircle, PhPushPin, PhTrash, PhCheck, PhX } from '@phosphor-icons/vue'
import type { ConversationSummary } from '@/types/api'

defineProps<{
  conversation: ConversationSummary
  active: boolean
  pinBusy: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  togglePin: [conversation: ConversationSummary]
  remove: [id: string]
}>()

// مدیریت حالت تایید حذف اینلاین (In-line Confirmation)
const confirmingDelete = ref(false)

function handleRemoveClick(id: string) {
  confirmingDelete.value = false
  emit('remove', id)
}
</script>

<template>
  <div
    class="group relative flex h-11 items-center overflow-hidden rounded-lg transition-colors"
    :class="active ? 'bg-primary-soft' : 'hover:bg-hover'"
  >
    <!-- عنوان گفتگو -->
    <button
      type="button"
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-start text-[13px] transition-colors"
      :class="active ? 'font-medium text-primary' : 'text-ink-muted group-hover:text-ink'"
      :title="conversation.title?.trim() || 'بدون عنوان'"
      @click="$emit('open', conversation.id)"
    >
      <PhChatsCircle class="size-4 shrink-0" aria-hidden="true" />
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="truncate">{{ conversation.title?.trim() || 'بدون عنوان' }}</span>
        <span
          v-if="conversation.modelDisplayName"
          class="truncate text-[11px] text-ink-muted/80"
        >{{ conversation.modelDisplayName }}</span>
      </span>
    </button>

    <!-- ابزارهای اصلی (پین و حذف) -->
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
        @click="confirmingDelete = true"
      >
        <PhTrash class="size-3.5" aria-hidden="true" />
      </button>
    </div>

    <!-- ✨ نوار تایید حذف اینلاین (In-line Confirm Overlay با انیمیشن) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-x-2"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-x-0"
      leave-to-class="opacity-0 translate-x-2"
    >
      <div
        v-if="confirmingDelete"
        class="absolute inset-0 z-10 flex items-center justify-between bg-surface/95 px-2 backdrop-blur-xs"
      >
        <span class="text-xs font-medium text-danger">حذف شود؟</span>
        <div class="flex items-center gap-1">
          <!-- دکمه تایید حذف -->
          <button
            type="button"
            class="size-6 inline-flex cursor-pointer items-center justify-center rounded-md bg-danger text-white hover:bg-danger/80 transition"
            title="تایید حذف"
            @click="handleRemoveClick(conversation.id)"
          >
            <PhCheck class="size-3.5" aria-hidden="true" />
          </button>
          <!-- دکمه انصراف -->
          <button
            type="button"
            class="size-6 inline-flex cursor-pointer items-center justify-center rounded-md bg-elevated text-ink-muted hover:bg-hover hover:text-ink transition"
            title="انصراف"
            @click="confirmingDelete = false"
          >
            <PhX class="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>