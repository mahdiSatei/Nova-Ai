<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    /** Optional class to add to the root element */
    class?: string
  }>(),
  {}
)
</script>

<template>
  <div
    class="rounded-lg bg-card text-ink border border-line hover:bg-elevated/50 transition-colors duration-150"
    :class="props.class"
  >
    <slot />
  </div>
</template>