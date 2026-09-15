<script setup lang="ts">
// لیست گفتگوهای کاربر با pagination «موارد بیشتر» (OQ-007: پیش‌فرض 20، سقف 100).
// طبق BR-016: فقط گفتگوهای خود کاربر را می‌بیند.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhChatCircleDots, PhClockCounterClockwise, PhTrash } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { listConversations, deleteConversation } from '@/api/conversations'
import { useModelsStore } from '@/stores/models'
import { usePagination } from '@/composables/usePagination'
import { relativeTime } from '@/utils/time'

const router = useRouter()
const models = useModelsStore()

const page = usePagination<import('@/types/api').ConversationSummary>(listConversations, { limit: 20 })

const deletingId = ref<string | null>(null)
const deleteBusy = ref(false)

onMounted(async () => {
  await models.load()
})

const items = computed(() => page.items.value)

async function onConfirmDelete(): Promise<void> {
  const id = deletingId.value
  if (!id) return
  deleteBusy.value = true
  try {
    await deleteConversation(id)
    page.remove((c) => c.id === id)
    deletingId.value = null
  } catch (err) {
    if (err instanceof ApiError) {
      page.error.value = err
    }
  } finally {
    deleteBusy.value = false
  }
}

function openConversation(id: string): void {
  void router.push({ name: 'chat-conversation', params: { id } })
}

function startDelete(id: string): void {
  deletingId.value = id
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
    <header class="flex items-center gap-3">
      <span class="flex size-9 items-center justify-center rounded-xl bg-primary-soft">
        <PhClockCounterClockwise class="size-4.5 text-primary" aria-hidden="true" />
      </span>
      <div>
        <h1 class="text-base font-semibold">تاریخچه گفتگوها</h1>
        <p class="text-xs text-ink-muted">گفتگوهای اخیر شما؛ برای حذف یا ادامه انتخاب کنید.</p>
      </div>
    </header>

    <ErrorBanner
      v-if="page.error.value"
      :message="apiErrorMessage(page.error.value)"
      :code="page.error.value.code"
      :request-id="page.error.value.requestId"
      :show-code="true"
    />

    <div v-if="page.initialLoading.value" class="flex flex-col gap-2">
      <div v-for="i in 4" :key="i" class="h-16 animate-pulse rounded-lg bg-surface" />
    </div>

    <EmptyState
      v-else-if="items.length === 0 && !page.error.value"
      title="گفتگویی ندارید."
      description="از صفحه چت اولین پیام خود را ارسال کنید تا گفتگوی جدیدی شروع شود."
    >
      <template #icon>
        <PhChatCircleDots class="size-7 text-primary" aria-hidden="true" />
      </template>
      <BaseButton size="sm" variant="primary" @click="router.push({ name: 'chat' })">شروع گفتگو</BaseButton>
    </EmptyState>

    <ul v-else class="mx-auto flex w-full max-w-3xl flex-col gap-2" role="list">
      <li
        v-for="c in items"
        :key="c.id"
        class="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-primary/40 hover:shadow-md"
      >
        <button
          type="button"
          class="min-w-0 flex-1 cursor-pointer text-start"
          @click="openConversation(c.id)"
        >
          <p class="truncate text-sm font-medium text-ink">
            {{ c.title?.trim() || 'بدون عنوان' }}
          </p>
          <p class="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
            <span>{{ models.displayName(c.modelId, 'مدل نامشخص') }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ relativeTime(c.updatedAt) }}</span>
          </p>
        </button>
        <BaseButton
          variant="ghost"
          size="sm"
          class="text-ink-muted hover:text-danger"
          :aria-label="'حذف گفتگو'"
          @click="startDelete(c.id)"
        >
          <PhTrash class="size-4" aria-hidden="true" />
        </BaseButton>
      </li>
    </ul>

    <div v-if="items.length > 0 && page.hasMore.value" class="flex justify-center pt-2">
      <BaseButton variant="secondary" size="sm" :loading="page.loading.value" @click="page.loadMore">
        موارد بیشتر
      </BaseButton>
    </div>

    <ConfirmModal
      :open="deletingId !== null"
      title="حذف گفتگو"
      description="این گفتگو و تمام پیام‌های آن برای همیشه حذف می‌شوند. این عملیات قابل بازگشت نیست."
      confirm-label="حذف"
      :busy="deleteBusy"
      @update:open="(v: boolean) => { if (!v) deletingId = null }"
      @confirm="onConfirmDelete"
    />
  </section>
</template>
