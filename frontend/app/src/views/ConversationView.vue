<script setup lang="ts">
// ConversationView: فقط خواندنی — ترنسکریپت کامل + ادامه گفتگو.
// «ادامه گفتگو» کاربر را به /chat/c/:id می‌برد تا بتواند پیام بعدی را بفرستد.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowRight, PhWarningCircle } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ShareButton from '@/components/chat/ShareButton.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { getConversation } from '@/api/conversations'
import { useModelsStore } from '@/stores/models'
import { formatDateTime } from '@/utils/time'
import type { ConversationDetail } from '@/types/api'

const props = defineProps<{ id: string }>()

const router = useRouter()
const models = useModelsStore()

const conversation = ref<ConversationDetail | null>(null)
const loading = ref(true)
const error = ref<ApiError | null>(null)

const modelAvailable = computed(() => {
  if (!conversation.value) return false

  const m = models.byId(conversation.value.modelId)

  // پیام‌ها خواندنی هستند حتی اگر مدل disable شده باشد.
  return Boolean(m)
})

onMounted(async () => {
  loading.value = true
  error.value = null

  try {
    await models.load()
    conversation.value = await getConversation(props.id)
  } catch (err) {
    if (err instanceof ApiError) {
      error.value = err
    }
  } finally {
    loading.value = false
  }
})

function onContinue(): void {
  void router.push({
    name: 'chat-conversation',
    params: { id: props.id },
  })
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
    <div v-if="loading" class="flex flex-col gap-3">
      <div class="h-12 animate-pulse rounded-lg bg-surface" />
      <div class="h-64 animate-pulse rounded-lg bg-surface" />
    </div>

    <template v-else-if="error">
      <ErrorBanner
        :message="apiErrorMessage(error)"
        :code="error.code"
        :request-id="error.requestId"
        :show-code="true"
      />

      <BaseButton
        variant="secondary"
        size="sm"
        class="self-start"
        @click="router.back()"
      >
        بازگشت
      </BaseButton>
    </template>

    <template v-else-if="conversation">
      <header
        class="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold">
            {{ conversation.title?.trim() || 'بدون عنوان' }}
          </p>

          <p class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>
              مدل: {{ models.displayName(conversation.modelId, '—') }}
            </span>

            <span aria-hidden="true">·</span>

            <span>
              ایجاد: {{ formatDateTime(conversation.createdAt) }}
            </span>

            <span aria-hidden="true">·</span>

            <span>
              به‌روزرسانی: {{ formatDateTime(conversation.updatedAt) }}
            </span>
          </p>
        </div>

        <ShareButton :conversation-id="conversation.id" />
      </header>

      <div
        v-if="!modelAvailable"
        class="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink"
      >
        <PhWarningCircle
          class="mt-0.5 size-4 shrink-0 text-accent"
          aria-hidden="true"
        />

        <p>
          مدل این گفتگو دیگر در دسترس نیست. ترنسکریپت همچنان قابل مشاهده است؛
          برای ادامه، یک گفتگوی جدید شروع کنید.
        </p>
      </div>

      <div
        class="flex min-h-[24rem] flex-col rounded-card border border-line bg-surface/60"
      >
        <div class="flex-1 px-4">
          <MessageList :messages="conversation.messages" />
        </div>

        <div
          class="flex items-center justify-between gap-2 border-t border-line bg-surface/40 px-4 py-3"
        >
          <p class="text-xs text-ink-muted">
            ارسال پیام جدید در ادامه گفتگو
          </p>

          <BaseButton
            variant="primary"
            size="sm"
            :disabled="!modelAvailable"
            @click="onContinue"
          >
            <PhArrowRight
              class="flip-rtl size-4"
              aria-hidden="true"
            />
            <span>ادامه گفتگو</span>
          </BaseButton>
        </div>
      </div>
    </template>
  </section>
</template>