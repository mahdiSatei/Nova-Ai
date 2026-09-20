<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { PhCaretDown, PhChartDonut, PhWallet } from '@phosphor-icons/vue'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function closeOnOutside(event: Event): void {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

function closeMenu(): void {
  open.value = false
}

onMounted(() => {
  void wallet.refresh()
  document.addEventListener('pointerdown', closeOnOutside)
  document.addEventListener('keydown', closeOnEscape)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', closeOnOutside)
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-hover hover:text-ink"
      :title="`${wallet.balance} اعتبار`"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <PhWallet class="size-3.5 shrink-0" aria-hidden="true" />
      <span>{{ wallet.formattedBalance }}</span>
      <span class="text-ink-muted/60">اعتبار</span>
      <PhCaretDown class="size-3 transition-transform" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      class="absolute end-0 top-full z-50 mt-2 w-56 rounded-xl border border-line bg-surface p-2 shadow-2xl"
      role="menu"
    >
      <div class="rounded-lg bg-primary-soft px-3 py-2.5">
        <p class="text-[11px] text-ink-muted">موجودی فعلی</p>
        <p class="mt-1 text-base font-bold text-primary">{{ wallet.formattedBalance }} اعتبار</p>
      </div>
      <RouterLink
        to="/chat/wallet"
        class="mt-2 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-ink transition-colors hover:bg-hover"
        role="menuitem"
        @click="closeMenu"
      >
        <PhWallet class="size-4 text-primary" aria-hidden="true" />
        <span>خرید اعتبار</span>
      </RouterLink>
      <RouterLink
        to="/chat/dashboard"
        class="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-ink transition-colors hover:bg-hover"
        role="menuitem"
        @click="closeMenu"
      >
        <PhChartDonut class="size-4 text-accent" aria-hidden="true" />
        <span>داشبورد مصرف</span>
      </RouterLink>
    </div>
  </div>
</template>
