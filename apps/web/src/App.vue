<script setup lang="ts">
import { RouterView } from 'vue-router'
import { computed } from 'vue'
import type { NavigationMenuItem } from '@nuxt/ui'

const items = computed<NavigationMenuItem[]>(() => [{
  label: 'Dashboard',
  icon: 'i-lucide-layout-dashboard',
  to: '/'
}, {
  label: 'Watchlists',
  icon: 'i-lucide-list',
  to: '/watchlists'
}, {
  label: 'Settings',
  icon: 'i-lucide-settings',
  to: '/config'
}])
</script>

<template>
  <UApp>
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
          <UButton
            :icon="collapsed ? 'i-lucide-log-out' : undefined"
            :label="collapsed ? undefined : 'Sign out'"
            color="neutral"
            variant="ghost"
            block
            to="/login"
          />
        </template>
      </UDashboardSidebar>

      <RouterView />
    </UDashboardGroup>
  </UApp>
</template>
