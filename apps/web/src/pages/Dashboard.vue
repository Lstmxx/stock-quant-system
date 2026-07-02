<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { api } from '../utils/api'
import { useSSELogStream } from '../composables/useSSE'

interface Task {
  id: string
  type: string
  status: string
  params: Record<string, unknown> | null
  result: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

const tasks = ref<Task[]>([])
const loading = ref(true)
const submitting = ref(false)
const targetSymbol = ref('')
const showNewTaskModal = ref(false)

const showLogsModal = ref(false)
const activeTaskId = ref('')
const { streamLogs: logs, connect: connectLogs, disconnect: disconnectLogs } = useSSELogStream()

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

type BadgeColor = 'neutral' | 'primary' | 'success' | 'error' | 'warning' | 'info'

const statusColor: Record<string, BadgeColor> = {
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

function viewLogs(taskId: string) {
  activeTaskId.value = taskId
  showLogsModal.value = true
  connectLogs(`/tasks/${taskId}/stream`)
}

function closeLogs() {
  showLogsModal.value = false
  disconnectLogs()
}

let interval: ReturnType<typeof setInterval>
onMounted(() => {
  fetchTasks()
  interval = setInterval(fetchTasks, 10000)
})

onUnmounted(() => {
  clearInterval(interval)
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
            :color="statusColor[row.original.status] || 'neutral'"
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
            v-if="row.original.status === 'RUNNING' || row.original.status === 'COMPLETED'"
            icon="i-lucide-activity"
            variant="ghost"
            size="xs"
            label="Logs"
            @click="viewLogs(row.original.id)"
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

  <!-- Logs Slideover -->
  <USlideover v-model:open="showLogsModal" :title="`Task Logs: ${activeTaskId}`" @close="closeLogs">
    <template #body>
      <div class="bg-gray-950 p-4 h-full overflow-y-auto text-green-400 font-mono text-sm whitespace-pre-wrap rounded-lg">
        <div v-if="logs.length === 0" class="text-gray-500 italic">Waiting for logs...</div>
        <div v-for="(log, idx) in logs" :key="idx">{{ log }}</div>
      </div>
    </template>
  </USlideover>
</template>
