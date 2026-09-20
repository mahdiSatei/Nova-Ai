<script setup lang="ts">
import { onMounted } from 'vue'
import { PhWallet } from '@phosphor-icons/vue'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()
onMounted(() => wallet.refresh())
</script>

<template>
  <div
    class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted"
    :title="`${wallet.balance} اعتبار`"
  >
    <PhWallet class="size-3.5 shrink-0" aria-hidden="true" />
    <span>{{ wallet.formattedBalance }}</span>
    <span class="text-ink-muted/60">اعتبار</span>
  </div>
</template>
