<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { TableColumn } from '@nuxt/ui'
import { api } from '../utils/api'

interface Watchlist {
  id: string
  symbol: string
  name: string | null
  createdAt: string
}

const watchlists = ref<Watchlist[]>([])
const loading = ref(true)
const showAddModal = ref(false)
const newSymbol = ref('')
const newName = ref('')
const adding = ref(false)

const columns: TableColumn<Watchlist>[] = [{
  accessorKey: 'symbol',
  header: 'Symbol'
}, {
  accessorKey: 'name',
  header: 'Name'
}, {
  accessorKey: 'createdAt',
  header: 'Added'
}, {
  id: 'actions',
  header: ''
}]

async function fetchWatchlists() {
  loading.value = true
  try {
    const { data } = await api.watchlists.get()
    if (data) watchlists.value = data as unknown as Watchlist[]
  } finally {
    loading.value = false
  }
}

async function addStock() {
  if (!newSymbol.value) return
  adding.value = true
  try {
    await api.watchlists.post({
      symbol: newSymbol.value,
      name: newName.value || undefined
    })
    newSymbol.value = ''
    newName.value = ''
    showAddModal.value = false
    await fetchWatchlists()
  } finally {
    adding.value = false
  }
}

async function deleteStock(id: string) {
  await api.watchlists({ id }).delete()
  await fetchWatchlists()
}

const router = useRouter()

function analyzeStock(symbol: string) {
  router.push(`/analysis?symbol=${symbol}`)
}

onMounted(fetchWatchlists)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Watchlists">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton icon="i-lucide-plus" label="Add Stock" @click="showAddModal = true" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UTable :data="watchlists" :columns="columns" :loading="loading">
        <template #name-cell="{ row }">
          {{ row.original.name || '—' }}
        </template>

        <template #createdAt-cell="{ row }">
          {{ new Date(row.original.createdAt).toLocaleDateString() }}
        </template>

        <template #actions-cell="{ row }">
          <div class="flex gap-1">
            <UButton
              icon="i-lucide-sparkles"
              color="primary"
              variant="ghost"
              size="xs"
              label="Analyze"
              @click="analyzeStock(row.original.symbol)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="deleteStock(row.original.id)"
            />
          </div>
        </template>

        <template #empty>
          <div class="text-center py-8 text-muted">
            <UIcon name="i-lucide-list-x" class="size-8 mb-2" />
            <p>No stocks in your watchlist yet.</p>
          </div>
        </template>
      </UTable>
    </template>
  </UDashboardPanel>

  <!-- Add Stock Modal -->
  <UModal v-model:open="showAddModal">
    <template #header>
      <h3 class="text-lg font-semibold text-default">Add Stock</h3>
    </template>
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="Symbol" required>
          <UInput v-model="newSymbol" placeholder="e.g. sh.600000" />
        </UFormField>
        <UFormField label="Name (optional)">
          <UInput v-model="newName" placeholder="e.g. 浦发银行" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="showAddModal = false" />
        <UButton label="Add" :loading="adding" @click="addStock" />
      </div>
    </template>
  </UModal>
</template>
