<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { api } from '../utils/api'

interface Factor {
  id: string
  name: string
  expression: string
  icValue: string
  icir: string
  monotonicity: string
  direction: string
  isValid: boolean
  generation: string
  createdAt: string
}

const factors = ref<Factor[]>([])
const loading = ref(true)

const columns: TableColumn<Factor>[] = [{
  accessorKey: 'name',
  header: 'Name'
}, {
  id: 'expression',
  header: 'Expression'
}, {
  accessorKey: 'icValue',
  header: 'IC'
}, {
  accessorKey: 'icir',
  header: 'ICIR'
}, {
  accessorKey: 'direction',
  header: 'Dir'
}, {
  accessorKey: 'isValid',
  header: 'Valid'
}, {
  accessorKey: 'createdAt',
  header: 'Created'
}]

async function fetchFactors() {
  loading.value = true
  try {
    const { data } = await api.factors.get()
    if (data) factors.value = data as unknown as Factor[]
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchFactors()
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Factor Library">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            variant="ghost"
            @click="fetchFactors"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UTable :data="factors" :columns="columns" :loading="loading">
        <template #expression-cell="{ row }">
          <code class="text-xs bg-gray-900 px-1 py-0.5 rounded text-primary">{{ row.original.expression }}</code>
        </template>

        <template #isValid-cell="{ row }">
          <UBadge
            :color="row.original.isValid ? 'success' : 'neutral'"
            :label="row.original.isValid ? 'Valid' : 'Invalid'"
            variant="subtle"
          />
        </template>

        <template #createdAt-cell="{ row }">
          {{ new Date(row.original.createdAt).toLocaleDateString() }}
        </template>

        <template #empty>
          <div class="text-center py-12 text-muted">
            <UIcon name="i-lucide-library" class="size-10 mb-3" />
            <p class="text-base">Factor library is empty.</p>
            <p class="text-sm mt-1">Start an analysis on the dashboard to discover factors.</p>
          </div>
        </template>
      </UTable>
    </template>
  </UDashboardPanel>
</template>
