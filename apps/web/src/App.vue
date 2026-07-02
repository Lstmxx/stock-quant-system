<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const toast = useToast()

const handleApiError = (event: Event) => {
  const customEvent = event as CustomEvent<string>
  toast.add({ title: 'API Error', description: customEvent.detail, color: 'error' })
}

onMounted(() => {
  window.addEventListener('api-error', handleApiError)
})

onUnmounted(() => {
  window.removeEventListener('api-error', handleApiError)
})
</script>

<template>
  <UApp>
    <RouterView />
  </UApp>
</template>
