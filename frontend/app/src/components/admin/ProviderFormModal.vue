<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue'
import ProviderForm from './ProviderForm.vue'
import type { ProviderAdmin } from '@/types/api'

defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': [provider: ProviderAdmin]
}>()

function onSaved(provider: ProviderAdmin) {
  emit('saved', provider)
  emit('update:open', false)
}

function onCancel() {
  emit('update:open', false)
}
</script>

<template>
  <BaseModal :open="open" @close="onCancel">
    <ProviderForm @saved="onSaved" @cancel="onCancel" />
  </BaseModal>
</template>
