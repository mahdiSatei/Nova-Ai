<script setup lang="ts">
defineProps<{
  open: boolean
}>()

defineEmits<{
  close: []
}>()
</script>

<template>
  <Transition name="modal">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        class="absolute inset-0 bg-bg/70 backdrop-blur-sm"
        @click="$emit('close')"
      />
      <div
        class="relative w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-xl"
        @click.stop
      >
        <slot />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
