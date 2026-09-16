<script setup lang="ts">
// گروه‌بندی گفتگوها: بخش «پین‌شده‌ها» (فقط در صورت وجود) بالای «آخرین گفتگوها»؛ هر دو تاشو.
import { computed } from 'vue'
import ConversationRow from './ConversationRow.vue'
import ConversationSection from './ConversationSection.vue'
import type { ConversationSummary } from '@/types/api'

const props = defineProps<{
  items: ConversationSummary[]
  activeId: string | null
  pinBusyIds: Set<string>
}>()

defineEmits<{
  open: [id: string]
  togglePin: [conversation: ConversationSummary]
  remove: [id: string]
}>()

const pinned = computed(() => props.items.filter((c) => c.pinned))
const recent = computed(() => props.items.filter((c) => !c.pinned))
</script>

<template>
  <p v-if="items.length === 0" class="px-3 py-6 text-center text-xs text-ink-muted/70">
    هنوز گفتگویی ندارید.
  </p>
  <div v-else class="flex flex-col gap-1">
    <ConversationSection v-if="pinned.length" title="پین‌شده‌ها" storage-key="mmcb.section.pinned">
      <ConversationRow
        v-for="c in pinned"
        :key="c.id"
        :conversation="c"
        :active="activeId === c.id"
        :pin-busy="pinBusyIds.has(c.id)"
        @open="$emit('open', $event)"
        @toggle-pin="$emit('togglePin', $event)"
        @remove="$emit('remove', $event)"
      />
    </ConversationSection>
    <ConversationSection v-if="recent.length" title="آخرین گفتگوها" storage-key="mmcb.section.recent">
      <ConversationRow
        v-for="c in recent"
        :key="c.id"
        :conversation="c"
        :active="activeId === c.id"
        :pin-busy="pinBusyIds.has(c.id)"
        @open="$emit('open', $event)"
        @toggle-pin="$emit('togglePin', $event)"
        @remove="$emit('remove', $event)"
      />
    </ConversationSection>
  </div>
</template>
