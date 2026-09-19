<script setup lang="ts">
// ChatView: صفحه اصلی چت — استریم‌محور با Markdown.
// states per FR-015 + BR-014: empty / no-models / streaming / error / success.
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhArrowsClockwise,
  PhSparkle,
  PhWarning,
  PhCaretDown,
  PhBrain,
  PhCode,
  PhBookOpenText,
  PhTranslate,
  PhMoon,
  PhSun,
  PhLightbulb,
  PhCalculator,
  PhFlask,
  PhTerminal,
  PhGlobeHemisphereWest,
} from '@phosphor-icons/vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import ModelPicker from '@/components/chat/ModelPicker.vue'
import MessageList from '@/components/chat/MessageList.vue'
import MessageInput from '@/components/chat/MessageInput.vue'
import type { UploadedFile } from '@/api/files'
import { useChatStream } from '@/composables/useChatStream'
import { useNewChatSignal } from '@/composables/useNewChatSignal'
import { useTheme } from '@/composables/useTheme'
import { useModelsStore } from '@/stores/models'
import { apiErrorMessage } from '@/utils/errors'
import { useQuota } from '@/composables/useQuota'

const { tick: newChatTick } = useNewChatSignal()

const props = defineProps<{ id?: string }>()

const route = useRoute()
const router = useRouter()
const models = useModelsStore()
const chat = useChatStream()
const theme = useTheme()

const inputText = ref('')

// فایل پیوست‌شده‌ی آماده برای پیام بعدی (شناسه‌اش همراه متن ارسال می‌شود).
const attachedFile = ref<UploadedFile | null>(null)

const justStartedConversation = ref(false)

// فاز ۵ — مانده سهمیه توکن، پیش از ارسال نمایش داده می‌شود.
const quota = useQuota()

onMounted(() => {
  void quota.loadQuota()
})

// فاز ۸ — کنترل استدلال فقط برای مدل‌هایی که پیکربندی مؤثرشان پشتیبانی را می‌گوید.
// (سرور مقدار ناشناخته را به «پشتیبانی نمی‌شود» تبدیل می‌کند، پس اینجا فقط
// supported===true معنا دارد.)
const reasoningSupported = computed(
  () => models.byId(chat.selectedModelId.value)?.reasoning?.supported === true,
)

watch(
  reasoningSupported,
  (supported) => chat.setReasoningSupport(supported),
  { immediate: true },
)

const scrollRoot = useTemplateRef<HTMLDivElement>('scrollRoot')

// scroll هوشمند: فقط وقتی کاربر پایین است خودکار پایین می‌رود.
const pinnedToBottom = ref(true)
const showScrollButton = ref(false)

const noModels = computed(() => models.loaded && models.isEmpty)

const hasMessages = computed(
  () =>
    chat.transcript.value.length > 0 ||
    chat.generation.value !== null,
)

const activeModelName = computed(() =>
  models.displayName(chat.selectedModelId.value, ''),
)

// ✨ جملات رندوم برای عنوان خوش‌آمدگویی
const welcomeHeadlines = [
  'چطور می‌تونم کمکت کنم؟',
  'امروز روی چه پروژه‌ای کار می‌کنیم؟',
  'سوالی داری؟ از من بپرس!',
  'آماده‌ام تا با هم ایده پردازی کنیم.',
  'چه کمکی از دست من برمی‌آید؟',
  'امروز دوست داری درباره چی صحبت کنیم؟',
]

const randomHeadline = ref('چطور می‌تونم کمکت کنم؟')

function randomizeHeadline() {
  const randomIndex = Math.floor(Math.random() * welcomeHeadlines.length)
  randomHeadline.value = welcomeHeadlines[randomIndex]!
}

// آرایه‌ای جامع از پرامپت‌های پیشنهادی برای انتخاب رندوم
const allPrompts = [
  { icon: PhSparkle, text: 'یک توضیح کوتاه از هوش مصنوعی بده.' },
  { icon: PhCode, text: 'یک تابع پایتونی برای بررسی اعداد اول بنویس.' },
  { icon: PhBookOpenText, text: 'چه فرقی بین REST و GraphQL هست؟' },
  { icon: PhTranslate, text: 'یک شعر کوتاه درباره تهران بنویس.' },
  { icon: PhLightbulb, text: 'چطور می‌تونم تمرکز خودم رو موقع برنامه‌نویسی بالا ببرم؟' },
  { icon: PhCalculator, text: 'مزایای استفاده از معماری میکروسرویس چیست؟' },
  { icon: PhFlask, text: 'تفاوت بین متد GET و POST در ای‌پیز چیست؟' },
  { icon: PhTerminal, text: 'چند دستور کاربردی گیت (Git) برای رفع تداخلات نام ببرید.' },
]

// انتخاب رندوم ۴ پرامپت در هر بار لود صفحه
const suggestedPrompts = ref<typeof allPrompts>([])

function randomizePrompts() {
  const shuffled = [...allPrompts].sort(() => 0.5 - Math.random())
  suggestedPrompts.value = shuffled.slice(0, 4)
}

function refreshWelcomeState() {
  randomizeHeadline()
  randomizePrompts()
}

function resolvedId(): string | undefined {
  const raw = props.id ?? (route.params.id as string | undefined)
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function onScroll(): void {
  const el = scrollRoot.value
  if (!el) return

  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  pinnedToBottom.value = distance < 120
  showScrollButton.value = distance > 400
}

function scrollToBottom(smooth = true): void {
  const el = scrollRoot.value
  if (!el) return

  el.scrollTo({
    top: el.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  })

  pinnedToBottom.value = true
  showScrollButton.value = false
}

// auto-scroll به پایین هنگام تغییر ترنسکریپت یا streaming text (اگر کاربر چسبیده باشد)
watch(
  () => [chat.transcript.value, chat.generation.value?.content],
  async () => {
    await nextTick()
    if (pinnedToBottom.value) scrollToBottom(false)
  },
  { deep: true },
)

onMounted(async () => {
  refreshWelcomeState()

  console.debug('[ChatView] onMounted start', {
    routeName: route.name,
    resolvedId: resolvedId(),
    propsId: props.id,
  })

  await models.load(true)

  if (!chat.selectedModelId.value) {
    const fallback = models.defaultModelId ?? models.items[0]?.id ?? null
    if (fallback) chat.setModel(fallback)
  } else if (!models.items.find((m) => m.id === chat.selectedModelId.value)) {
    chat.setModel(models.defaultModelId ?? models.items[0]?.id ?? null)
  }

  const id = resolvedId()

  console.debug('[ChatView] onMounted resolvedId', { id })

  if (id) {
    await chat.loadConversation(id)

    // The conversation was deleted (404): loadConversation already reset
    // state and set the banner — just move the URL back to new-chat.
    if (chat.connectionError.value?.code === 'conversation_not_found') {
      void router.replace({ name: 'chat' })
    }
  } else {
    const stored = chat.loadSavedConversationId()

    if (stored) {
      void router.replace({
        name: 'chat-conversation',
        params: { id: stored },
      })
    } else {
      chat.resetConversation()
    }
  }

  console.debug('[ChatView] onMounted after load', {
    transcriptLen: chat.transcript.value.length,
    generation: chat.generation.value,
  })

  pinnedToBottom.value = true
  await nextTick()
  scrollToBottom(false)
})

watch(
  () => resolvedId(),
  async (id) => {
    console.debug('[ChatView] route watch resolvedId', { id })

    if (id) {
      // If we're already streaming this conversation (the id was just
      // adopted via the SSE start event), only sync the URL — reloading
      // would tear down and re-subscribe the live stream.
      if (
        chat.generationState.value === 'streaming' &&
        chat.generation.value?.conversationId === id
      ) {
        return
      }

      await chat.loadConversation(id)

      if (chat.connectionError.value?.code === 'conversation_not_found') {
        void router.replace({ name: 'chat' })
      }
    } else {
      // Returning to /chat right after a stale-conversation 404: the
      // banner was just set — don't wipe it with a full reset.
      refreshWelcomeState()

      if (chat.connectionError.value?.code !== 'conversation_not_found') {
        chat.resetConversation()
      }
    }

    pinnedToBottom.value = true
    await nextTick()
    scrollToBottom(false)
  },
)

watch(
  () => chat.conversationId.value,
  (id) => {
    if (!id) return

    const routeId = resolvedId()
    if (routeId === id) return

    if (justStartedConversation.value) {
      void router.replace({
        name: 'chat-conversation',
        params: { id },
      })
      justStartedConversation.value = false
    }
  },
)

// «گفتگوی جدید» از سایدبار وقتی همین‌جا هستیم: reset مستقیم (بدون تغییر مسیر)
watch(newChatTick, () => {
  if (resolvedId() || route.name !== 'chat') return

  inputText.value = ''
  refreshWelcomeState()
  chat.resetConversation()
})

async function onSubmit(): Promise<void> {
  const text = inputText.value

  if (!text.trim() || chat.inputDisabled.value) return

  if (!resolvedId()) {
    justStartedConversation.value = true
  }

  const fileToAttach = attachedFile.value
  const fileId = fileToAttach?.id ?? null

  inputText.value = ''
  attachedFile.value = null
  pinnedToBottom.value = true

  await chat.send(text, {
    fileId,
    file: fileToAttach,
  })
}

async function onStop(): Promise<void> {
  await chat.cancel()
}

function onRetry(failedMessageId: string): void {
  void chat.retry(failedMessageId)
}

function onReconnect(): void {
  void chat.reconnect()
}

function useSuggestedPrompt(text: string): void {
  inputText.value = text
  nextTick(() => scrollToBottom())
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col py-2 sm:py-3">
    <!-- هدر شناور: چیپ وضعیت + مدل + ابزارها -->
    <header class="flex h-11 shrink-0 items-center gap-2 px-1">
      <!-- Connection status banner -->
      <div
        v-if="chat.connectionState.value !== 'connected'"
        class="mx-auto w-full max-w-3xl"
      >
        <div
          class="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm"
          :class="
            chat.connectionState.value === 'reconnecting'
              ? 'border-primary/40 bg-primary-soft text-primary'
              : 'border-accent/40 bg-accent/10 text-ink'
          "
        >
          <div class="flex items-center gap-2">
            <PhWarning
              v-if="chat.connectionState.value === 'disconnected'"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            <PhArrowsClockwise
              v-else
              class="size-4 animate-spin shrink-0"
              aria-hidden="true"
            />
            <span class="font-medium">
              {{
                chat.connectionState.value === 'disconnected'
                  ? 'اتصال با سرور قطع شد.'
                  : 'در حال اتصال مجدد…'
              }}
            </span>
          </div>

          <button
            v-if="
              chat.connectionState.value === 'disconnected' &&
              chat.generationState.value === 'streaming'
            "
            type="button"
            class="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft"
            @click="onReconnect"
          >
            <PhArrowsClockwise class="size-3.5" aria-hidden="true" />
            <span>اتصال مجدد</span>
          </button>
        </div>
      </div>

      <!-- status chip + model picker + buttons -->
      <div
        class="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 py-1 pe-1 ps-3 text-xs shadow-sm backdrop-blur transition-colors"
      >
        <span
          class="size-1.5 rounded-full"
          :class="
            chat.generationState.value === 'streaming'
              ? 'animate-pulse bg-primary'
              : 'bg-success'
          "
          aria-hidden="true"
        />

        <span class="font-medium text-ink">
          {{
            chat.connectionState.value === 'disconnected'
              ? 'قطع شده'
              : chat.generationState.value === 'streaming'
                ? 'در حال پاسخ…'
                : 'آماده'
          }}
        </span>

        <span
          v-if="!noModels"
          class="h-4 w-px bg-line"
          aria-hidden="true"
        />

        <ModelPicker
          v-if="!noModels"
          v-model="chat.selectedModelId.value"
          :disabled="chat.inputDisabled.value"
          inline
        />

        <span
          v-if="activeModelName"
          class="hidden text-ink-muted sm:inline"
        >
          — {{ activeModelName }}
        </span>
      </div>

      <div class="ms-auto flex items-center gap-1">
        <!-- فاز ۷ — کلید جستجوی وب -->
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          :class="
            chat.webSearchEnabled.value
              ? 'border-primary/60 bg-primary-soft text-primary'
              : 'border-line bg-surface/70 text-ink-muted hover:text-ink'
          "
          :aria-pressed="chat.webSearchEnabled.value"
          :disabled="chat.inputDisabled.value"
          :title="
            chat.webSearchEnabled.value
              ? 'جستجوی وب روشن است'
              : 'جستجوی وب خاموش است'
          "
          @click="chat.setWebSearch(!chat.webSearchEnabled.value)"
        >
          <PhGlobeHemisphereWest class="size-3.5" aria-hidden="true" />
          <span>جستجوی وب</span>
        </button>

        <!-- فاز ۸ — کلید استدلال (فقط برای مدل‌های پشتیبان) -->
        <button
          v-if="reasoningSupported"
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          :class="
            chat.reasoningEnabled.value
              ? 'border-primary/60 bg-primary-soft text-primary'
              : 'border-line bg-surface/70 text-ink-muted hover:text-ink'
          "
          :aria-pressed="chat.reasoningEnabled.value"
          :disabled="chat.inputDisabled.value"
          :title="
            chat.reasoningEnabled.value
              ? 'استدلال روشن است'
              : 'استدلال خاموش است'
          "
          @click="chat.setReasoning(!chat.reasoningEnabled.value)"
        >
          <PhBrain class="size-3.5" aria-hidden="true" />
          <span>استدلال</span>
        </button>

        <button
          type="button"
          class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:text-ink"
          :aria-label="theme.theme.value === 'light' ? 'حالت تاریک' : 'حالت روشن'"
          :title="theme.theme.value === 'light' ? 'تاریک' : 'روشن'"
          @click="theme.toggleTheme()"
        >
          <PhMoon
            v-if="theme.theme.value === 'light'"
            class="size-4"
            aria-hidden="true"
          />
          <PhSun
            v-else
            class="size-4"
            aria-hidden="true"
          />
        </button>
      </div>
    </header>

    <!-- ناحیه پیام‌ها -->
    <div class="relative min-h-0 flex-1">
      <div
        ref="scrollRoot"
        class="absolute inset-0 overflow-y-auto scroll-smooth px-2 sm:px-4"
        @scroll="onScroll"
      >
        <!-- empty state: hero + کارت‌های پیشنهاد -->
        <div
          v-if="!hasMessages"
          class="flex min-h-full flex-col items-center justify-center gap-8 py-10 text-center"
        >
          <div class="flex flex-col items-center gap-4">
            <div
              class="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent/70 text-white shadow-lg shadow-primary/20"
            >
              <PhBrain class="size-7" aria-hidden="true" />
            </div>

            <div>
              <h1 class="text-xl font-bold text-ink sm:text-2xl">
                {{ noModels ? 'چت هنوز آماده نیست' : randomHeadline }}
              </h1>

              <p class="mt-1.5 text-sm text-ink-muted">
                {{
                  noModels
                    ? 'مدیر سیستم باید ابتدا یک مدل فعال اضافه کند.'
                    : 'پیام خود را بنویسید یا یکی از پیشنهادها را انتخاب کنید.'
                }}
              </p>
            </div>
          </div>

          <ul
            v-if="!noModels"
            class="grid w-full max-w-xl grid-cols-1 gap-2.5 px-2 sm:grid-cols-2"
          >
            <li v-for="p in suggestedPrompts" :key="p.text">
              <button
                type="button"
                class="group flex h-full w-full cursor-pointer items-start gap-3 rounded-xl border border-line/70 bg-surface px-4 py-3.5 text-start shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                @click="useSuggestedPrompt(p.text)"
              >
                <span
                  class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary"
                >
                  <component
                    :is="p.icon"
                    class="size-4"
                    aria-hidden="true"
                  />
                </span>

                <span
                  class="text-sm leading-6 text-ink-muted transition-colors group-hover:text-ink"
                >
                  {{ p.text }}
                </span>
              </button>
            </li>
          </ul>
        </div>

        <template v-else>
          <!-- error model load -->
          <div
            v-if="models.error"
            class="mx-auto max-w-3xl py-4"
          >
            <ErrorBanner
              :message="apiErrorMessage(models.error)"
              :code="models.error.code"
              :request-id="models.error.requestId"
              :show-code="true"
            />
          </div>

          <!-- خطای اتصال یا استریم داخل فید -->
          <div
            v-if="chat.connectionError.value"
            class="mx-auto max-w-3xl"
          >
            <ErrorBanner
              :message="chat.connectionError.value.message"
              :code="chat.connectionError.value.code"
              :show-code="true"
            />

            <div
              v-if="chat.transcript.value.length > 0"
              class="mt-2 mb-1 flex items-center gap-1.5 px-3 text-[11px] text-warning"
            >
              <PhWarning
                class="size-3"
                aria-hidden="true"
              />
              پاسخ ناقص — متن قبل از خطا حفظ شده است.
            </div>
          </div>

          <MessageList
            :messages="chat.transcript.value"
            :generation="chat.generation.value"
            :search-activity="chat.searchActivity.value"
            :reasoning-active="chat.reasoningActive.value"
            :reasoning-completed="chat.reasoningCompleted.value"
            :reasoning-summary="chat.reasoningSummary.value"
            :on-retry="onRetry"
            :on-reconnect="onReconnect"
            :on-cancel="onStop"
          />
        </template>
      </div>

      <!-- دکمه اسکرول به پایین -->
      <button
        v-if="showScrollButton && hasMessages"
        type="button"
        class="absolute bottom-4 left-1/2 z-10 inline-flex size-9 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink-muted shadow-lg transition-all hover:bg-elevated hover:text-ink"
        aria-label="رفتن به پایین آخرین پیام"
        @click="scrollToBottom()"
      >
        <PhCaretDown class="size-4" aria-hidden="true" />
      </button>
    </div>

    <!-- پایین: ورودی شناور -->
    <div class="shrink-0 px-1 pb-2 pt-1 sm:pb-3">
      <div class="mx-auto w-full max-w-3xl">
        <!-- فاز ۵ — سهمیه باقی‌مانده / حالت اتمام سهمیه -->
        <div
          v-if="quota.quota.value && !quota.isUnlimited.value"
          class="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs"
        >
          <span
            v-if="quota.isExhausted.value"
            class="text-danger"
          >
            سهمیه توکن شما به اتمام رسیده است. برای ادامه با مدیر سیستم تماس بگیرید.
          </span>

          <span
            v-else
            class="text-ink-muted"
          >
            {{ quota.remainingLabel.value }}
          </span>

          <div
            class="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-elevated"
            role="presentation"
          >
            <div
              class="h-full rounded-full transition-all"
              :class="
                quota.percentUsed.value >= 90
                  ? 'bg-danger'
                  : 'bg-accent'
              "
              :style="{ width: `${quota.percentUsed.value}%` }"
            />
          </div>
        </div>

        <p
          v-if="chat.retrying.value"
          class="px-4 py-1 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          در حال تلاش مجدد ({{ chat.retrying.value.attempt }} از
          {{ chat.retrying.value.maxAttempts }})…
        </p>

        <MessageInput
          v-model="inputText"
          v-model:attachment="attachedFile"
          :placeholder="
            quota.isExhausted.value
              ? 'سهمیه توکن شما به اتمام رسیده است.'
              : noModels
                ? 'مدلی برای گفتگو موجود نیست.'
                : 'پیام خود را بنویسید…'
          "
          :disabled="chat.inputDisabled.value || quota.isExhausted.value"
          :busy="chat.generationState.value === 'streaming'"
          @submit="onSubmit"
          @stop="onStop"
        />
      </div>
    </div>
  </section>
</template>