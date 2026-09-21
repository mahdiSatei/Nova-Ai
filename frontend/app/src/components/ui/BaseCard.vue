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
    class="surface-card interactive-lift text-ink"
    :class="props.class"
  >
    <slot />
  </div>
</template>