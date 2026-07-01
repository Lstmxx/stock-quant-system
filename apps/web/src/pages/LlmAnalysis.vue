<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import type { TableColumn } from '@nuxt/ui'
import { api } from '../utils/api'

// ─── Types ───

interface AnalysisTask {
  id: string
  type: string
  status: string
  params: { symbol?: string; analysisType?: string } | null
  result: AnalysisReport | { error: string } | null
  createdAt: string
  updatedAt: string
}

interface AnalysisReport {
  symbol: string
  name: string
  analysisDate: string
  summary: string
  overallScore: number
  trend: { direction: 'UP' | 'DOWN' | 'SIDEWAYS'; strength: number; description: string }
  signals: Array<{ type: string; value: number; label: string; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' }>
  factors: Array<{ expression: string; icValue: string; icir: string; direction: string }>
  risk: { level: 'LOW' | 'MEDIUM' | 'HIGH'; notes: string }
  recommendation: 'BUY' | 'HOLD' | 'SELL' | 'WATCH'
  rawReport: string
}

// ─── State ───

const tasks = ref<AnalysisTask[]>([])
const loading = ref(true)
const submitting = ref(false)
const symbol = ref('')
const showNewModal = ref(false)

const showReportModal = ref(false)
const activeReport = ref<AnalysisReport | null>(null)
const activeTaskId = ref('')
const streamLogs = ref<string[]>([])
let eventSource: EventSource | null = null

// ─── Table ───

const columns: TableColumn<AnalysisTask>[] = [
  { accessorKey: 'type', header: 'Type' },
  { id: 'symbol', header: 'Symbol' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Created' },
  { id: 'actions', header: '' },
]

const statusColor: Record<string, string> = {
  PENDING: 'warning',
  PENDING_DATA: 'warning',
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'error',
}

const scoreColor = (score: number) => {
  if (score >= 70) return 'text-green-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

const recommendationBadge: Record<string, string> = {
  BUY: 'success',
  HOLD: 'warning',
  SELL: 'error',
  WATCH: 'info',
}

const trendIcon: Record<string, string> = {
  UP: 'i-lucide-trending-up',
  DOWN: 'i-lucide-trending-down',
  SIDEWAYS: 'i-lucide-minus',
}

// ─── Data ───

async function fetchTasks() {
  loading.value = true
  try {
    const { data } = await api.analysis.get()
    if (data) tasks.value = data as unknown as AnalysisTask[]
  } finally {
    loading.value = false
  }
}

async function startAnalysis() {
  if (!symbol.value) return
  submitting.value = true
  try {
    const { data } = await api.analysis.start.post({
      symbol: symbol.value,
      type: 'SINGLE_STOCK',
    })
    if (data) {
      symbol.value = ''
      showNewModal.value = false
      await fetchTasks()
      // Immediately open SSE for the new task
      viewLogs((data as { taskId: string }).taskId)
    }
  } finally {
    submitting.value = false
  }
}

function viewReport(task: AnalysisTask) {
  if (!task.result || 'error' in task.result) return
  activeReport.value = task.result as AnalysisReport
  showReportModal.value = true
}

function viewLogs(taskId: string) {
  activeTaskId.value = taskId
  streamLogs.value = []

  if (eventSource) eventSource.close()

  eventSource = new EventSource(`http://localhost:3000/analysis/${taskId}/stream`)
  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data)
      if (parsed.type !== 'ping' && parsed.type !== 'connected') {
        streamLogs.value.push(parsed.message ?? JSON.stringify(parsed))
      }
    } catch {
      streamLogs.value.push(event.data)
    }
  }
  eventSource.onerror = () => eventSource?.close()
}

function closeReport() {
  showReportModal.value = false
  activeReport.value = null
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

// ─── Polling ───

const route = useRoute()

let interval: ReturnType<typeof setInterval>
onMounted(() => {
  fetchTasks()
  interval = setInterval(fetchTasks, 10000)
  // If navigated from Watchlist with ?symbol=xxx, pre-fill and open modal
  if (route.query.symbol) {
    symbol.value = route.query.symbol as string
    showNewModal.value = true
  }
})
onUnmounted(() => {
  clearInterval(interval)
  if (eventSource) eventSource.close()
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="LLM Analysis">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-sparkles"
            label="New Analysis"
            @click="showNewModal = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UTable :data="tasks" :columns="columns" :loading="loading">
        <template #type-cell="{ row }">
          <UBadge
            :label="row.original.type === 'LLM_ANALYSIS' ? 'LLM Analysis' : row.original.type"
            color="primary"
            variant="subtle"
          />
        </template>

        <template #symbol-cell="{ row }">
          {{ row.original.params?.symbol ?? '—' }}
        </template>

        <template #status-cell="{ row }">
          <div class="flex items-center gap-2">
            <UIcon
              v-if="row.original.status === 'RUNNING'"
              name="i-lucide-loader-2"
              class="animate-spin size-4 text-info"
            />
            <UBadge
              :color="(statusColor[row.original.status] || 'neutral') as any"
              :label="row.original.status"
              variant="subtle"
            />
          </div>
        </template>

        <template #createdAt-cell="{ row }">
          {{ new Date(row.original.createdAt).toLocaleString() }}
        </template>

        <template #actions-cell="{ row }">
          <div class="flex gap-1">
            <UButton
              v-if="row.original.status === 'COMPLETED'"
              icon="i-lucide-bar-chart-2"
              variant="ghost"
              size="xs"
              label="Report"
              @click="viewReport(row.original)"
            />
            <UButton
              v-if="row.original.status === 'RUNNING'"
              icon="i-lucide-activity"
              variant="ghost"
              size="xs"
              label="Live"
              @click="viewLogs(row.original.id)"
            />
            <UBadge
              v-if="row.original.status === 'FAILED' && row.original.result && 'error' in row.original.result"
              color="error"
              variant="subtle"
              :label="(row.original.result as any).error?.slice(0, 40)"
            />
          </div>
        </template>

        <template #empty>
          <div class="text-center py-12 text-muted">
            <UIcon name="i-lucide-sparkles" class="size-10 mb-3" />
            <p class="text-base">No analyses yet.</p>
            <p class="text-sm mt-1">Click "New Analysis" to start an LLM stock analysis.</p>
          </div>
        </template>
      </UTable>
    </template>
  </UDashboardPanel>

  <!-- New Analysis Modal -->
  <UModal v-model:open="showNewModal">
    <template #header>
      <h3 class="text-lg font-semibold text-default">Start LLM Analysis</h3>
    </template>
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="Stock Symbol" required description="e.g. sh.600000 for Shanghai stocks">
          <UInput v-model="symbol" placeholder="sh.600000" />
        </UFormField>
        <p class="text-sm text-muted">
          The system will fetch market data and run a comprehensive LLM analysis on the stock.
          If data is not cached, this may take a moment.
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="showNewModal = false" />
        <UButton
          label="Start Analysis"
          icon="i-lucide-sparkles"
          :loading="submitting"
          @click="startAnalysis"
        />
      </div>
    </template>
  </UModal>

  <!-- Report Modal -->
  <UModal v-model:open="showReportModal" :ui="{ width: 'max-w-3xl' }" @close="closeReport">
    <template #header>
      <div class="flex items-center gap-3" v-if="activeReport">
        <div>
          <h3 class="text-lg font-bold text-default">
            {{ activeReport.name }} <span class="text-muted font-normal text-sm ml-1">{{ activeReport.symbol }}</span>
          </h3>
          <p class="text-xs text-muted">{{ activeReport.analysisDate }}</p>
        </div>
        <div class="ml-auto flex items-center gap-3">
          <div :class="['text-3xl font-bold', scoreColor(activeReport.overallScore)]">
            {{ activeReport.overallScore }}
          </div>
          <UBadge
            :color="(recommendationBadge[activeReport.recommendation] || 'neutral') as any"
            :label="activeReport.recommendation"
            size="lg"
          />
        </div>
      </div>
    </template>

    <template #body v-if="activeReport">
      <div class="space-y-5 p-4">
        <!-- Summary -->
        <UAlert icon="i-lucide-info" :description="activeReport.summary" color="primary" variant="subtle" />

        <!-- Trend -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-semibold">
              <UIcon :name="trendIcon[activeReport.trend.direction]" class="size-4" />
              Trend — {{ activeReport.trend.direction }}
              <UProgress class="ml-auto w-24" :value="activeReport.trend.strength * 100" size="sm" />
            </div>
          </template>
          <p class="text-sm text-muted">{{ activeReport.trend.description }}</p>
        </UCard>

        <!-- Signals -->
        <div v-if="activeReport.signals?.length">
          <p class="text-sm font-semibold text-default mb-2">Signals</p>
          <div class="grid grid-cols-2 gap-2">
            <UCard
              v-for="(sig, i) in activeReport.signals"
              :key="i"
              class="p-3"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted">{{ sig.label }}</span>
                <UBadge
                  :color="sig.sentiment === 'BULLISH' ? 'success' : sig.sentiment === 'BEARISH' ? 'error' : 'neutral'"
                  :label="sig.sentiment"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <div class="text-lg font-bold text-default mt-1">{{ typeof sig.value === 'number' ? sig.value.toFixed(3) : sig.value }}</div>
            </UCard>
          </div>
        </div>

        <!-- Alpha Factors -->
        <div v-if="activeReport.factors?.length">
          <p class="text-sm font-semibold text-default mb-2">Supporting Alpha Factors</p>
          <div class="space-y-1">
            <div
              v-for="(f, i) in activeReport.factors"
              :key="i"
              class="flex items-center gap-3 text-xs p-2 bg-gray-900 rounded"
            >
              <code class="text-primary flex-1 truncate">{{ f.expression }}</code>
              <span class="text-muted">IC: {{ f.icValue }}</span>
              <span class="text-muted">ICIR: {{ f.icir }}</span>
            </div>
          </div>
        </div>

        <!-- Risk -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 text-sm font-semibold">
              <UIcon name="i-lucide-shield-alert" class="size-4" />
              Risk —
              <UBadge
                :color="activeReport.risk.level === 'LOW' ? 'success' : activeReport.risk.level === 'HIGH' ? 'error' : 'warning'"
                :label="activeReport.risk.level"
                variant="subtle"
              />
            </div>
          </template>
          <p class="text-sm text-muted">{{ activeReport.risk.notes }}</p>
        </UCard>
      </div>
    </template>
  </UModal>

  <!-- Live Log Slideover (shown while task is RUNNING) -->
  <USlideover
    v-model:open="!!activeTaskId && streamLogs.length >= 0 && !showReportModal"
    :title="`Live — ${activeTaskId}`"
    @close="activeTaskId = ''; streamLogs = []"
  >
    <template #body>
      <div class="bg-gray-950 p-4 h-full overflow-y-auto text-green-400 font-mono text-sm whitespace-pre-wrap rounded-lg">
        <div v-if="streamLogs.length === 0" class="text-gray-500 italic">Connecting to analysis stream...</div>
        <div v-for="(log, idx) in streamLogs" :key="idx">{{ log }}</div>
      </div>
    </template>
  </USlideover>
</template>
