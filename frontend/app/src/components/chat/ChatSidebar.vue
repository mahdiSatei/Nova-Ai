<script setup lang="ts">
// نوار کنایی مدرن: گفتگوی جدید + آخرین گفتگوها (پین/حذف) + حالت/کاربر.
// دسکتاپ: جمع‌شونده به ریل آیکون (localStorage)؛ موبایل: کشوی روی‌صفحه‌ای.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  PhChatCircleText,
  PhPlus,
  PhList,
  PhSignOut,
  PhChatsCircle,
  PhUserGear,
} from '@phosphor-icons/vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ConversationGroups from '@/components/chat/ConversationGroups.vue'
import ProfileModal from '@/components/user/ProfileModal.vue'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { avatarValueFor } from '@/utils/avatar'
import { requestNewChat } from '@/composables/useNewChatSignal'
import { useChatStream } from '@/composables/useChatStream'
import { listConversations, deleteConversation, setConversationPinned } from '@/api/conversations'
import type { ConversationSummary } from '@/types/api'

const emit = defineEmits<{ navigate: [] }>()
const mobileOpen = defineModel<boolean>('mobileOpen', { required: true })

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
// Only for the localStorage id helpers — no stream state is touched here.
const chat = useChatStream()

const collapsed = ref(localStorage.getItem('mmcb.sidebar') === 'collapsed')
const items = ref<ConversationSummary[]>([])
const loading = ref(false)
const pinBusyIds = ref<Set<string>>(new Set())
const deletingId = ref<string | null>(null)
const deleteBusy = ref(false)
const profileOpen = ref(false)

// منوی حساب کاربری (پروفایل/خروج)
const userMenuOpen = ref(false)
const userMenuRoot = ref<HTMLElement | null>(null)

function onDocPointerDownUserMenu(e: Event): void {
  const root = userMenuRoot.value
  if (root && !root.contains(e.target as Node)) userMenuOpen.value = false
}

function onUserMenuKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') userMenuOpen.value = false
}

function onEditProfile(): void {
  userMenuOpen.value = false
  closeMobile()
  profileOpen.value = true
}

async function onMenuSignOut(): Promise<void> {
  userMenuOpen.value = false
  await onSignOut()
}

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

const profileLabel = computed(
  () => auth.user?.displayName ?? auth.user?.email ?? 'حساب کاربری',
)

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
    // Keep the persisted last-conversation id from pointing at a deleted
    // row — otherwise the next reload 404-loops on it.
    if (chat.loadSavedConversationId() === id) chat.clearSavedConversationId()
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
  document.addEventListener('pointerdown', onDocPointerDownUserMenu)
}
function unbindFlyoutDismiss(): void {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onFlyoutKeydown)
  document.removeEventListener('pointerdown', onDocPointerDownUserMenu)
}
onMounted(bindFlyoutDismiss)
onUnmounted(unbindFlyoutDismiss)

// وقتی ریل بسته شد، فلای‌اوت را ببند.
watch(rail, (open) => {
  if (!open) closeFlyout()
})

// بستن منوی کاربر هنگام ناوبری
watch(
  () => route.fullPath,
  () => {
    userMenuOpen.value = false
  },
)

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
        <div class="max-h-[60vh] overflow-y-auto">
          <ConversationGroups
            :items="items"
            :active-id="activeId"
            :pin-busy-ids="pinBusyIds"
            @open="go"
            @toggle-pin="onTogglePin"
            @remove="startDelete"
          />
        </div>
      </div>
    </div>

    <!-- آخرین گفتگوها -->
    <nav v-if="!rail" class="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2" :aria-label="'آخرین گفتگوها'">
      <div v-if="loading && items.length === 0" class="flex flex-col gap-1.5 px-1">
        <div v-for="i in 5" :key="i" class="h-9 animate-pulse rounded-lg bg-elevated" />
      </div>
      <ConversationGroups
        v-else
        :items="items"
        :active-id="activeId"
        :pin-busy-ids="pinBusyIds"
        @open="go"
        @toggle-pin="onTogglePin"
        @remove="startDelete"
      />
    </nav>

    <!-- فوتر: حالت مدیر، کاربر (منوی پروفایل/خروج) -->
    <div class="mt-auto shrink-0 border-t border-line/70 p-2">
      <RouterLink
        v-if="auth.isAdmin"
        to="/admin/provider"
        class="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink lg:justify-start"
        @click="closeMobile"
      >
        <span class="min-w-9 flex justify-center"><PhList class="size-4" aria-hidden="true" /></span>
        <span v-if="!rail">حالت مدیر</span>
      </RouterLink>

      <!-- ردیف کاربر + منو -->
      <div ref="userMenuRoot" class="relative mt-1">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-start transition-colors hover:bg-hover"
          :class="{ 'justify-center px-0': rail }"
          :aria-label="'منوی حساب کاربری'"
          :aria-haspopup="'menu'"
          :aria-expanded="userMenuOpen"
          @click="userMenuOpen = !userMenuOpen"
        >
          <span class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-elevated">
            <UserAvatar :value="auth.user ? avatarValueFor(auth.user) : 'anonymous'" :size="28" />
          </span>
          <span v-if="!rail" class="min-w-0 flex-1 truncate text-xs text-ink-muted" :dir="auth.user?.displayName ? undefined : 'ltr'">
            {{ profileLabel }}
          </span>
        </button>

        <div
          v-if="userMenuOpen"
          class="absolute bottom-full start-0 z-50 mb-2 w-48 rounded-xl border border-line bg-surface p-1.5 shadow-2xl"
          role="menu"
          @keydown="onUserMenuKeydown"
        >
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-ink transition-colors hover:bg-hover"
            role="menuitem"
            @click="onEditProfile"
          >
            <PhUserGear class="size-4 shrink-0" aria-hidden="true" />
            <span>ویرایش پروفایل</span>
          </button>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-danger transition-colors hover:bg-danger-soft"
            role="menuitem"
            @click="onMenuSignOut"
          >
            <PhSignOut class="flip-rtl size-4 shrink-0" aria-hidden="true" />
            <span>خروج از حساب</span>
          </button>
        </div>
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

  <ProfileModal :open="profileOpen" @update:open="profileOpen = $event" />
</template>
