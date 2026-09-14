<script setup lang="ts">
// ChatView: صفحه اصلی چت — طراحی AI-Native با تمرکز بر streaming.
// states per FR-015 + BR-014: empty / no-models / streaming / error / success.
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhPlus, PhArrowsClockwise, PhSparkle, PhWarning } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import ModelPicker from '@/components/chat/ModelPicker.vue'
import MessageList from '@/components/chat/MessageList.vue'
import MessageInput from '@/components/chat/MessageInput.vue'
import { useChatStream } from '@/composables/useChatStream'
import { useModelsStore } from '@/stores/models'

const props = defineProps<{ id?: string }>()

const route = useRoute()
const router = useRouter()
const models = useModelsStore()
const chat = useChatStream()

const inputText = ref('')
const justStartedConversation = ref(false)
const scrollRoot = useTemplateRef<HTMLDivElement>('scrollRoot')

const noModels = computed(() => models.loaded && models.isEmpty)
const inputDisabled = computed(
  () => chat.isStreaming.value || noModels.value || chat.phase.value === 'loading',
)
const currentModelName = computed(
  () => models.displayName(chat.selectedModelId.value, '—') || 'مدل انتخاب نشده',
)

function resolvedId(): string | undefined {
  const raw = props.id ?? (route.params.id as string | undefined)
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

// auto-scroll به پایین هنگام تغییر ترنسکریپت یا streaming text
watch(
  () => [chat.transcript.value, chat.streamingText.value, chat.pendingUser.value],
  async () => {
    await nextTick()
    const el = scrollRoot.value
    if (el) el.scrollTop = el.scrollHeight
  },
  { deep: true },
)

watch(
  () => resolvedId(),
  async (id) => {
    if (id) await chat.loadConversation(id)
    else chat.resetConversation()
  },
  { immediate: true },
)

onMounted(async () => {
  await models.load()
  if (!chat.selectedModelId.value) {
    const fallback = models.defaultModelId ?? models.items[0]?.id ?? null
    if (fallback) chat.setModel(fallback)
  } else if (!models.items.find((m) => m.id === chat.selectedModelId.value)) {
    chat.setModel(models.defaultModelId ?? models.items[0]?.id ?? null)
  }
})

watch(
  () => chat.conversationId.value,
  (id) => {
    if (!id) return
    const routeId = resolvedId()
    if (routeId === id) return
    if (justStartedConversation.value) {
      void router.replace({ name: 'chat-conversation', params: { id } })
      justStartedConversation.value = false
    }
  },
)

async function onSubmit(): Promise<void> {
  const text = inputText.value
  if (!text.trim() || inputDisabled.value) return
  if (!resolvedId()) justStartedConversation.value = true
  inputText.value = ''
  await chat.send(text)
}

async function onNewChat(): Promise<void> {
  inputText.value = ''
  if (route.name === 'chat-conversation') {
    await router.push({ name: 'chat' })
  } else {
    chat.resetConversation()
  }
}

async function onRefreshModels(): Promise<void> {
  await models.load(true)
}

function useSuggestedPrompt(text: string): void {
  inputText.value = text
}

const suggestedPrompts = [
  'یک توضیح کوتاه از هوش مصنوعی بده.',
  'چه فرقی بین REST و GraphQL هست؟',
  'یک شعر کوتاه درباره تهران بنویس.',
]
</script>

<template>
  <section class="flex flex-1 flex-col py-3 sm:py-4">
    <!-- هدر با model picker به‌صورت chip -->
    <header class="mb-3 flex items-center gap-3 px-1 sm:mb-4">
      <div
        class="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-xs transition-colors"
      >
        <span
          class="size-1.5 rounded-full"
          :class="chat.isStreaming.value ? 'bg-primary animate-pulse' : 'bg-success'"
          aria-hidden="true"
        />
        <span class="font-medium text-ink">{{ currentModelName }}</span>
        <span v-if="chat.isStreaming.value" class="text-ink-muted">· در حال پاسخ…</span>
        <span v-else class="text-ink-muted/70">· آماده</span>
      </div>

      <div class="ms-auto flex items-center gap-1.5">
        <button
          type="button"
          class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-elevated hover:text-ink focus-visible:text-ink"
          :class="{ 'animate-spin': models.loading }"
          :disabled="models.loading"
          aria-label="به‌روزرسانی مدل‌ها"
          @click="onRefreshModels"
        >
          <PhArrowsClockwise class="size-4" aria-hidden="true" />
        </button>
        <BaseButton
          variant="secondary"
          size="sm"
          :disabled="chat.isStreaming.value || (!id && chat.transcript.value.length === 0)"
          @click="onNewChat"
        >
          <PhPlus class="size-4" aria-hidden="true" />
          <span>گفتگوی جدید</span>
        </BaseButton>
      </div>
    </header>

    <!-- کارت اصلی چت -->
    <div
      class="flex flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface/40 backdrop-blur-sm"
    >
      <!-- Model picker خطی در بالای محتوا، فقط وقتی مدل فعال است -->
      <div
        v-if="!noModels"
        class="flex items-center gap-3 border-b border-line/60 bg-elevated/30 px-4 py-2.5"
      >
        <PhSparkle class="size-3.5 text-primary" aria-hidden="true" />
        <ModelPicker v-model="chat.selectedModelId.value" :disabled="chat.isStreaming.value" inline />
      </div>

      <!-- ناحیه پیام‌ها با auto-scroll -->
      <div ref="scrollRoot" class="relative flex-1 overflow-y-auto px-3 sm:px-6">
        <!-- empty state با prompt‌های پیشنهادی -->
        <div
          v-if="chat.transcript.value.length === 0 && !chat.pendingUser.value && !chat.streamingText.value"
          class="flex min-h-full flex-col items-center justify-center gap-6 py-12 text-center"
        >
          <div class="flex flex-col items-center gap-3">
            <div class="flex size-12 items-center justify-center rounded-2xl bg-primary/15">
              <PhSparkle class="size-6 text-primary" aria-hidden="true" />
            </div>
            <div>
              <p class="text-base font-semibold text-ink">
                {{ noModels ? 'چت هنوز آماده نیست' : 'گفتگو را شروع کنید' }}
              </p>
              <p class="mt-1 text-sm text-ink-muted">
                {{ noModels ? 'مدیر سیستم باید ابتدا یک مدل فعال اضافه کند.' : 'پیام خود را بنویسید یا یکی از پیشنهادها را انتخاب کنید.' }}
              </p>
            </div>
          </div>

          <ul v-if="!noModels" class="grid w-full max-w-md gap-2">
            <li v-for="p in suggestedPrompts" :key="p">
              <button
                type="button"
                class="w-full cursor-pointer rounded-xl border border-line/60 bg-surface px-4 py-3 text-start text-sm text-ink-muted transition-colors hover:border-primary/40 hover:bg-elevated/40 hover:text-ink"
                @click="useSuggestedPrompt(p)"
              >
                {{ p }}
              </button>
            </li>
          </ul>
        </div>

        <!-- error model load (مدیر سیستم دسترسی مشکل دارد) -->
        <div v-if="models.error" class="mx-auto max-w-md py-6">
          <ErrorBanner
            :message="models.error.message"
            :code="models.error.code"
            :request-id="models.error.requestId"
            :show-code="true"
          />
        </div>

        <!-- لیست پیام‌ها -->
        <MessageList
          v-if="chat.transcript.value.length > 0 || chat.pendingUser.value || chat.streamingText.value"
          :messages="chat.transcript.value"
          :pending-user="chat.pendingUser.value"
          :streaming-text="chat.streamingText.value"
          :is-streaming="chat.isStreaming.value"
          :stream-completed-at="chat.streamCompletedAt.value"
        />
      </div>

      <!-- پایین: خطای استریم + input -->
      <div class="border-t border-line/60 bg-elevated/30 px-3 py-3 sm:px-6 sm:py-4">
        <ErrorBanner
          v-if="chat.streamError.value"
          :message="chat.streamError.value.message"
          :code="chat.streamError.value.code"
          :show-code="true"
          class="mb-3"
        />
        <div
          v-if="chat.streamError.value && chat.streamingText.value"
          class="mb-2 flex items-center gap-1.5 text-[11px] text-warning"
        >
          <PhWarning class="size-3" aria-hidden="true" />
          پاسخ ناقص — متن قبل از خطا حفظ شده است.
        </div>
        <MessageInput
          v-model="inputText"
          :placeholder="noModels ? 'مدلی برای گفتگو موجود نیست.' : 'پیام خود را بنویسید… (Enter برای ارسال، Shift+Enter خط جدید)'"
          :disabled="inputDisabled"
          :busy="chat.isStreaming.value"
          @submit="onSubmit"
        />
      </div>
    </div>
  </section>
</template>
