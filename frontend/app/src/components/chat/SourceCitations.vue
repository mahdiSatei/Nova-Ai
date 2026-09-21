<script setup lang="ts">
// فهرست منابع پاسخ وب: هر منبع با شناسه پایدار و لینک قابل کلیک.
import { PhLinkSimple } from '@phosphor-icons/vue'
import type { CitationSource } from '@/types/api'

defineProps<{ sources: CitationSource[] }>()
</script>

<template>
  <ul v-if="sources.length" class="mt-3 flex flex-wrap gap-2" aria-label="منابع">
    <li v-for="source in sources" :key="source.id">
      <a
        :href="source.url"
        target="_blank"
        rel="noopener noreferrer nofollow"
        class="inline-flex max-w-72 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-primary/50 hover:text-ink"
        :title="source.snippet"
      >
        <span class="font-mono text-[10px] text-primary">{{ source.id }}</span>
        <PhLinkSimple class="size-3 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ source.title || source.url }}</span>
      </a>
    </li>
  </ul>
</template>
