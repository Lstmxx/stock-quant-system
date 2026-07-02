<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { NavigationMenuItem } from '@nuxt/ui'
import { authClient } from '../utils/auth-client'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const items = computed<NavigationMenuItem[]>(() => [{
  label: 'Dashboard',
  icon: 'i-lucide-layout-dashboard',
  to: '/dashboard'
}, {
  label: 'Strategy Architect',
  icon: 'i-lucide-compass',
  to: '/strategy'
}, {
  label: 'LLM Analysis',
  icon: 'i-lucide-sparkles',
  to: '/analysis'
}, {
  label: 'Watchlists',
  icon: 'i-lucide-list',
  to: '/watchlists'
}, {
  label: 'Factor Library',
  icon: 'i-lucide-library',
  to: '/factors'
}, {
  label: 'Settings',
  icon: 'i-lucide-settings',
  to: '/config'
}])

async function handleLogout() {
  await authClient.signOut()
  authStore.setUser(null)
  router.push('/login')
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable>
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 p-2">
          <UIcon name="i-lucide-trending-up" class="size-6 text-primary" />
          <span v-if="!collapsed" class="text-lg font-bold text-default">Stock Quant</span>
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="items"
          orientation="vertical"
        />
      </template>

      <template #footer="{ collapsed }">
        <div v-if="authStore.user" class="flex items-center gap-2 p-2 mb-2">
          <UAvatar :alt="authStore.user.name || authStore.user.email" size="xs" />
          <span v-if="!collapsed" class="text-sm text-muted truncate">{{ authStore.user.name || authStore.user.email }}</span>
        </div>
        <UButton
          :icon="collapsed ? 'i-lucide-log-out' : undefined"
          :label="collapsed ? undefined : 'Sign out'"
          color="neutral"
          variant="ghost"
          block
          @click="handleLogout"
        />
      </template>
    </UDashboardSidebar>

    <RouterView />
  </UDashboardGroup>
</template>
