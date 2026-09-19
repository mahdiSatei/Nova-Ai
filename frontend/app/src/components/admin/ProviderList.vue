<script setup lang="ts">
import { ref } from 'vue'
import { PhCaretDown, PhCaretRight, PhPlus } from '@phosphor-icons/vue'
import ApiKeyManager from './ApiKeyManager.vue'
import type { ProviderAdmin } from '@/types/api'

const props = defineProps<{
  providers: ProviderAdmin[]
}>()

const emit = defineEmits<{
  'create-provider': []
}>()

const expandedId = ref<string | null>(null)

function toggle(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-medium text-ink">ارائه‌دهندگان</h2>
      <button
        class="flex items-center gap-1 text-sm text-primary hover:underline"
        @click="emit('create-provider')"
      >
        <PhPlus class="size-4" />
        افزودن ارائه‌دهنده
      </button>
    </div>

    <div
      v-for="provider in providers"
      :key="provider.id"
      class="rounded-lg border border-line"
    >
      <div
        :data-testid="`provider-${provider.id}`"
        class="flex items-center justify-between p-3 cursor-pointer hover:bg-elevated"
        @click="toggle(provider.id)"
      >
        <div class="flex items-center gap-2">
          <component :is="expandedId === provider.id ? PhCaretDown : PhCaretRight" class="size-4 text-ink-muted" />
          <span class="font-medium text-sm">{{ provider.name }}</span>
          <span class="text-xs text-ink-muted">({{ provider.apiKeys?.length ?? 0 }} کلید)</span>
          <span
            class="rounded-full px-2 py-0.5 text-xs"
            :class="provider.isActive ? 'bg-success/15 text-success' : 'bg-line text-ink-muted'"
          >
            {{ provider.isActive ? 'فعال' : 'غیرفعال' }}
          </span>
        </div>
        <span class="text-xs text-ink-muted font-mono">{{ provider.baseUrl }}</span>
      </div>

      <div v-if="expandedId === provider.id" class="border-t border-line p-3">
        <ApiKeyManager :provider-id="provider.id" />
      </div>
    </div>

    <p v-if="providers.length === 0" class="text-sm text-ink-muted text-center py-4">
      هنوز ارائه‌دهنده‌ای پیکربندی نشده است.
    </p>
  </div>
</template>
