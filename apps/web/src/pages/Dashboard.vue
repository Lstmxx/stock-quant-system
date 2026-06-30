<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { api } from '../utils/api'

interface Task {
  id: string
  type: string
  status: string
  params: any
  result: any
  createdAt: string
  updatedAt: string
}

const tasks = ref<Task[]>([])
const loading = ref(true)
const submitting = ref(false)
const targetSymbol = ref('')
const showNewTaskModal = ref(false)

const columns: TableColumn<Task>[] = [{
  accessorKey: 'type',
  header: 'Type'
}, {
  accessorKey: 'status',
  header: 'Status'
}, {
  id: 'params',
  header: 'Target'
}, {
  accessorKey: 'createdAt',
  header: 'Created'
}, {
  id: 'actions',
  header: ''
}]

const statusColor: Record<string, string> = {
  PENDING: 'warning',
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'error'
}

async function fetchTasks() {
  loading.value = true
  try {
    const { data } = await api.tasks.get()
    if (data) tasks.value = data as unknown as Task[]
  } finally {
    loading.value = false
  }
}

async function submitTask() {
  if (!targetSymbol.value) return
  submitting.value = true
  try {
    await api.tasks.mining.post({
      targetSymbol: targetSymbol.value
    })
    targetSymbol.value = ''
    showNewTaskModal.value = false
    await fetchTasks()
  } finally {
    submitting.value = false
  }
}

// Auto-refresh every 10s for task status updates
let interval: ReturnType<typeof setInterval>
onMounted(() => {
  fetchTasks()
  interval = setInterval(fetchTasks, 10000)
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-play"
            label="New Analysis"
            @click="showNewTaskModal = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UTable :data="tasks" :columns="columns" :loading="loading">
        <template #status-cell="{ row }">
          <UBadge
            :color="(statusColor[row.original.status] || 'neutral') as any"
            :label="row.original.status"
            variant="subtle"
          />
        </template>

        <template #params-cell="{ row }">
          {{ row.original.params?.targetSymbol || '—' }}
        </template>

        <template #createdAt-cell="{ row }">
          {{ new Date(row.original.createdAt).toLocaleString() }}
        </template>

        <template #actions-cell="{ row }">
          <UButton
            v-if="row.original.status === 'COMPLETED'"
            icon="i-lucide-eye"
            variant="ghost"
            size="xs"
            label="View"
          />
        </template>

        <template #empty>
          <div class="text-center py-12 text-muted">
            <UIcon name="i-lucide-bar-chart-3" class="size-10 mb-3" />
            <p class="text-base">No analysis tasks yet.</p>
            <p class="text-sm mt-1">Click "New Analysis" to start factor mining.</p>
          </div>
        </template>
      </UTable>
    </template>
  </UDashboardPanel>

  <!-- New Task Modal -->
  <UModal v-model:open="showNewTaskModal">
    <template #header>
      <h3 class="text-lg font-semibold text-default">Start New Analysis</h3>
    </template>
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="Target Symbol" required>
          <UInput v-model="targetSymbol" placeholder="e.g. sh.600000" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="showNewTaskModal = false" />
        <UButton label="Start Mining" icon="i-lucide-play" :loading="submitting" @click="submitTask" />
      </div>
    </template>
  </UModal>
</template>
