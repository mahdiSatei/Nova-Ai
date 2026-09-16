<script setup lang="ts">
// نوار کنایی مدرن: گفتگوی جدید + آخرین گفتگوها (پین/حذف) + حالت/کاربر.
// دسکتاپ: جمع‌شونده به ریل آیکون (localStorage)؛ موبایل: کشوی روی‌صفحه‌ای.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  PhChatCircleText,
  PhPlus,
  PhList,
  PhPushPin,
  PhSignOut,
  PhChatsCircle,
  PhTrash,
} from '@phosphor-icons/vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useAuthStore } from '@/stores/auth'
import { requestNewChat } from '@/composables/useNewChatSignal'
import { listConversations, deleteConversation, setConversationPinned } from '@/api/conversations'
import { relativeTime } from '@/utils/time'
import type { ConversationSummary } from '@/types/api'

const emit = defineEmits<{ navigate: [] }>()
const mobileOpen = defineModel<boolean>('mobileOpen', { required: true })

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const collapsed = ref(localStorage.getItem('mmcb.sidebar') === 'collapsed')
const items = ref<ConversationSummary[]>([])
const loading = ref(false)
const pinBusyIds = ref<Set<string>>(new Set())
const deletingId = ref<string | null>(null)
const deleteBusy = ref(false)

// فلای‌اوت گفتگوها در حالت ریل (هاور + تپ)
const flyoutOpen = ref(false)
const flyoutRoot = ref<HTMLElement | null>(null)
let flyoutCloseTimer: ReturnType<typeof setTimeout> | null = null

function cancelFlyoutClose(): void {
  if (flyoutCloseTimer) {
    clearTimeout(flyoutCloseTimer)
    flyoutCloseTimer = null
  }
}

function openFlyout(): void {
  cancelFlyoutClose()
  flyoutOpen.value = true
}

function scheduleCloseFlyout(): void {
  cancelFlyoutClose()
  flyoutCloseTimer = setTimeout(() => {
    flyoutOpen.value = false
  }, 150)
}

function closeFlyout(): void {
  cancelFlyoutClose()
  flyoutOpen.value = false
}

function toggleFlyout(): void {
  cancelFlyoutClose()
  flyoutOpen.value = !flyoutOpen.value
}

function onDocPointerDown(e: Event): void {
  const root = flyoutRoot.value
  if (root && !root.contains(e.target as Node)) closeFlyout()
}

function onFlyoutKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeFlyout()
}

const rail = computed(() => collapsed.value && !mobileOpen.value)
const activeId = computed(() =>
  route.name === 'chat-conversation' ? String(route.params.id ?? '') : null,
)

const initials = computed(() => auth.user?.email.slice(0, 2).toUpperCase() ?? '··')

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const page = await listConversations({ limit: 25 })
    items.value = page.items
  } catch {
    /* sidebar is non-critical; keep previous list */
  } finally {
    loading.value = false
  }
}

function toggleCollapse(): void {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem('mmcb.sidebar', collapsed.value ? 'collapsed' : 'expanded')
  } catch {
    /* ignore */
  }
}

function closeMobile(): void {
  mobileOpen.value = false
}

function go(id: string): void {
  closeFlyout()
  closeMobile()
  emit('navigate')
  void router.push({ name: 'chat-conversation', params: { id } })
}

async function onNewChat(): Promise<void> {
  closeMobile()
  emit('navigate')
  if (route.name === 'chat-conversation' || route.name === 'conversation') {
    await router.push({ name: 'chat' })
  } else {
    requestNewChat()
  }
}

async function onSignOut(): Promise<void> {
  await auth.signOut()
  closeMobile()
  await router.push('/login')
}

async function onTogglePin(c: ConversationSummary): Promise<void> {
  if (pinBusyIds.value.has(c.id)) return
  const next = !c.pinned
  pinBusyIds.value = new Set(pinBusyIds.value).add(c.id)
  try {
    await setConversationPinned(c.id, next)
    const target = items.value.find((x) => x.id === c.id)
    if (target) target.pinned = next
    await refresh()
  } catch {
    /* keep optimistic state out; list stays as-is on failure */
  } finally {
    const s = new Set(pinBusyIds.value)
    s.delete(c.id)
    pinBusyIds.value = s
  }
}

function startDelete(id: string): void {
  deletingId.value = id
}

async function onConfirmDelete(): Promise<void> {
  const id = deletingId.value
  if (!id) return
  deleteBusy.value = true
  try {
    await deleteConversation(id)
    items.value = items.value.filter((c) => c.id !== id)
    deletingId.value = null
    if (activeId.value === id) {
      closeMobile()
      emit('navigate')
      await router.push({ name: 'chat' })
    }
  } catch {
    /* surface by refreshing; deleted row simply remains if the call failed */
    await refresh()
  } finally {
    deleteBusy.value = false
  }
}

onMounted(refresh)

// بستن فلای‌اوت با کلیک بیرون یا Esc (لمسی/کیبورد)
function bindFlyoutDismiss(): void {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onFlyoutKeydown)
}
function unbindFlyoutDismiss(): void {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onFlyoutKeydown)
}
onMounted(bindFlyoutDismiss)
onUnmounted(unbindFlyoutDismiss)

// وقتی ریل بسته شد، فلای‌اوت را ببند.
watch(rail, (open) => {
  if (!open) closeFlyout()
})

// بعد از بازگشت به /chat یا تغییر گفتگو، لیست را تازه نگه دار.
watch(
  () => [route.name, activeId.value],
  () => {
    void refresh()
  },
)
</script>

<template>
  <!-- backdrop موبایل -->
  <div
    v-if="mobileOpen"
    class="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
    @click="closeMobile"
    aria-hidden="true"
  />

  <aside
    class="fixed inset-y-0 start-0 z-40 flex flex-col border-e border-line bg-surface transition-[width,transform] duration-300 ease-out lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0!"
    :class="[
      rail ? 'w-16' : 'w-72',
      mobileOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full',
    ]"
    :aria-label="'نوار کنایی'"
  >
    <!-- هدر: لوگو + جمع‌کردن -->
    <div class="flex h-14 shrink-0 items-center gap-2 px-3">
      <RouterLink v-if="!rail" to="/chat" class="flex min-w-0 items-center gap-2" @click="closeMobile">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
          <PhChatCircleText class="size-4.5 text-primary" aria-hidden="true" />
        </span>
        <span v-if="!rail" class="truncate text-sm font-semibold text-ink">چت‌بات چند مدله</span>
      </RouterLink>
      <!-- جمع‌کردن (حالت باز) / بازکردن (حالت ریل) -->
      <button
        type="button"
        class="ms-auto hidden size-8 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:inline-flex"
        :aria-label="rail ? 'باز کردن نوار کناری' : 'جمع کردن نوار کناری'"
        @click="toggleCollapse"
      >
        <PhList class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="ms-auto size-8 inline-flex cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:hidden"
        aria-label="بستن منو"
        @click="closeMobile"
      >
        <span class="text-lg leading-none" aria-hidden="true">×</span>
      </button>
    </div>

    <!-- گفتگوی جدید -->
    <div class="px-3">
      <button
        type="button"
        class="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-on-primary shadow-sm transition-colors hover:bg-primary-hover"
        :title="'گفتگوی جدید'"
        @click="onNewChat"
      >
        <PhPlus class="size-4 shrink-0" aria-hidden="true" />
        <span v-if="!rail">گفتگوی جدید</span>
      </button>
    </div>

    <!-- حالت ریل: دکمه «گفتگوها» با فلای‌اوت (هاور/تپ) -->
    <div
      v-if="rail"
      ref="flyoutRoot"
      class="relative mt-4 flex shrink-0 justify-center px-2"
      @mouseenter="openFlyout"
      @mouseleave="scheduleCloseFlyout"
    >
      <button
        type="button"
        class="flex size-9 cursor-pointer items-center justify-center rounded-lg transition-colors"
        :class="
          flyoutOpen
            ? 'bg-primary-soft text-primary'
            : 'text-ink-muted hover:bg-hover hover:text-ink'
        "
        aria-label="نمایش گفتگوها"
        :aria-expanded="flyoutOpen"
        @click="toggleFlyout"
      >
        <PhChatsCircle class="size-4.5" aria-hidden="true" />
      </button>

      <div
        v-if="flyoutOpen"
        class="absolute top-0 start-full z-50 ms-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-2xl"
        @mouseenter="cancelFlyoutClose"
        @mouseleave="scheduleCloseFlyout"
      >
        <p class="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted/70">
          آخرین گفتگوها
        </p>
        <p v-if="items.length === 0" class="px-3 py-4 text-center text-xs text-ink-muted/70">
          هنوز گفتگویی ندارید.
        </p>
        <ul v-else class="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
          <li v-for="c in items" :key="c.id">
            <div
              class="group flex h-9 items-center overflow-hidden rounded-lg transition-colors"
              :class="activeId === c.id ? 'bg-primary-soft' : 'hover:bg-hover'"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-start text-[13px] transition-colors"
                :class="
                  activeId === c.id
                    ? 'font-medium text-primary'
                    : 'text-ink-muted group-hover:text-ink'
                "
                :title="c.title?.trim() || 'بدون عنوان'"
                @click="go(c.id)"
              >
                <PhChatsCircle class="size-4 shrink-0" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate">{{ c.title?.trim() || 'بدون عنوان' }}</span>
                <span class="shrink-0 text-[10px] text-ink-muted/60">{{ relativeTime(c.updatedAt) }}</span>
              </button>
              <div class="flex shrink-0 items-center">
                <button
                  type="button"
                  class="size-7 inline-flex cursor-pointer items-center justify-center rounded-md transition-[color,background-color,opacity] focus-visible:opacity-100"
                  :class="
                    c.pinned
                      ? 'opacity-100 text-primary'
                      : 'opacity-0 group-hover:opacity-100 text-ink-muted/70 hover:text-ink'
                  "
                  :aria-label="c.pinned ? 'برداشتن پین گفتگو' : 'پین کردن گفتگو'"
                  :title="c.pinned ? 'برداشتن پین' : 'پین کردن'"
                  :disabled="pinBusyIds.has(c.id)"
                  @click="onTogglePin(c)"
                >
                  <PhPushPin class="size-3.5" :weight="c.pinned ? 'fill' : 'regular'" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="size-7 inline-flex cursor-pointer items-center justify-center rounded-md opacity-0 text-ink-muted/70 transition-[color,background-color,opacity] group-hover:opacity-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100"
                  aria-label="حذف گفتگو"
                  title="حذف گفتگو"
                  @click="startDelete(c.id)"
                >
                  <PhTrash class="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- آخرین گفتگوها -->
    <nav v-if="!rail" class="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2" :aria-label="'آخرین گفتگوها'">
      <p v-if="!rail" class="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted/70">
        آخرین گفتگوها
      </p>
      <div v-if="loading && items.length === 0" class="flex flex-col gap-1.5 px-1">
        <div v-for="i in 5" :key="i" class="h-9 animate-pulse rounded-lg bg-elevated" :class="{ 'ms-4': rail }" />
      </div>
      <p v-else-if="items.length === 0" class="px-3 py-6 text-center text-xs text-ink-muted/70">
        {{ rail ? '' : 'هنوز گفتگویی ندارید.' }}
      </p>
      <ul v-else class="flex flex-col gap-0.5">
        <li v-for="c in items" :key="c.id">
          <div
            class="group relative flex h-9 items-center overflow-hidden rounded-lg transition-colors"
            :class="[activeId === c.id ? 'bg-primary-soft' : 'hover:bg-hover', { 'justify-center': rail }]"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-start text-[13px] transition-colors"
              :class="
                activeId === c.id
                  ? 'font-medium text-primary'
                  : 'text-ink-muted group-hover:text-ink'
              "
              :style="rail ? 'flex:0 0 auto' : ''"
              :title="c.title?.trim() || 'بدون عنوان'"
              @click="go(c.id)"
            >
              <PhChatsCircle class="size-4 shrink-0" aria-hidden="true" />
              <template v-if="!rail">
                <span class="min-w-0 flex-1 truncate">{{ c.title?.trim() || 'بدون عنوان' }}</span>
                <span class="shrink-0 text-[10px] text-ink-muted/60">{{ relativeTime(c.updatedAt) }}</span>
              </template>
            </button>
            <div v-if="!rail" class="flex shrink-0 items-center">
              <button
                type="button"
                class="size-7 inline-flex cursor-pointer items-center justify-center rounded-md transition-[color,background-color,opacity] focus-visible:opacity-100 max-lg:opacity-100"
                :class="
                  c.pinned
                    ? 'opacity-100 text-primary'
                    : 'opacity-0 group-hover:opacity-100 text-ink-muted/70 hover:text-ink'
                "
                :aria-label="c.pinned ? 'برداشتن پین گفتگو' : 'پین کردن گفتگو'"
                :title="c.pinned ? 'برداشتن پین' : 'پین کردن'"
                :disabled="pinBusyIds.has(c.id)"
                @click="onTogglePin(c)"
              >
                <PhPushPin class="size-3.5" :weight="c.pinned ? 'fill' : 'regular'" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="size-7 inline-flex cursor-pointer items-center justify-center rounded-md opacity-0 text-ink-muted/70 transition-[color,background-color,opacity] group-hover:opacity-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 max-lg:opacity-100"
                aria-label="حذف گفتگو"
                title="حذف گفتگو"
                @click="startDelete(c.id)"
              >
                <PhTrash class="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </nav>

    <!-- فوتر: حالت مدیر، کاربر -->
    <div class="shrink-0 border-t border-line/70 p-2">
      <RouterLink
        v-if="auth.isAdmin"
        to="/admin/provider"
        class="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:justify-start"
        @click="closeMobile"
      >
        <span class="min-w-9 flex justify-center"><PhList class="size-4" aria-hidden="true" /></span>
        <span v-if="!rail">حالت مدیر</span>
      </RouterLink>

      <div class="mt-1 flex items-center gap-1" :class="{ 'flex-col': rail }">
        <button
          v-if="!rail"
          type="button"
          class="flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
          aria-label="خروج از حساب"
          @click="onSignOut"
        >
          <PhSignOut class="flip-rtl size-4" aria-hidden="true" />
        </button>
      </div>

      <div
        class="mt-2 flex items-center gap-2 rounded-lg px-1.5 py-1.5"
        :class="{ 'justify-center px-0': rail }"
        :title="auth.user?.email"
      >
        <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-[10px] font-bold text-ink-muted">
          {{ initials }}
        </span>
        <span v-if="!rail" class="min-w-0 flex-1 truncate text-xs text-ink-muted" dir="ltr">{{ auth.user?.email }}</span>
      </div>
    </div>
  </aside>

  <ConfirmModal
    :open="deletingId !== null"
    title="حذف گفتگو"
    description="این گفتگو و تمام پیام‌های آن برای همیشه حذف می‌شوند. این عملیات قابل بازگشت نیست."
    confirm-label="حذف"
    :busy="deleteBusy"
    @update:open="(v: boolean) => { if (!v) deletingId = null }"
    @confirm="onConfirmDelete"
  />
</template>
