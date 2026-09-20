<script setup lang="ts">
import { ref } from 'vue'
import { PhShareNetwork } from '@phosphor-icons/vue'
import { createShareSnapshot } from '@/api/sharing'

const props = defineProps<{ conversationId: string }>()

const loading = ref(false)
const error = ref<string | null>(null)
const copied = ref(false)

async function onShare(): Promise<void> {
  loading.value = true
  error.value = null
  copied.value = false
  try {
    const result = await createShareSnapshot(props.conversationId)
    const url = `${window.location.origin}/s/${result.shareId}`
    await navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'خطا در ایجاد لینک اشتراک‌گذاری'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-50"
    :disabled="loading"
    title="اشتراک‌گذاری گفتگو"
    @click="onShare"
  >
    <PhShareNetwork class="size-3.5 shrink-0" aria-hidden="true" />
    <span v-if="copied" class="text-success">کپی شد ✓</span>
    <span v-else>{{ loading ? 'در حال ایجاد...' : 'اشتراک‌گذاری' }}</span>
  </button>
  <span v-if="error" class="text-xs text-danger">{{ error }}</span>
</template>
