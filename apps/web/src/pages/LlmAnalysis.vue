<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
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
  const isFirstLoad = loading.value
  try {
    const { data } = await api.analysis.get()
    if (data) {
      tasks.value = data as unknown as AnalysisTask[]
      
      // Auto-transition: if the active task completes, show its report.
      if (activeTaskId.value) {
        const activeTask = tasks.value.find(t => t.id === activeTaskId.value)
        if (activeTask && activeTask.status === 'COMPLETED') {
          // Task just completed! Show report and close logs.
          closeLogs()
          viewReport(activeTask)
        }
      }
    }
  } finally {
    if (isFirstLoad) loading.value = false
  }
}

async function startAnalysis() {
  if (!symbol.value) return
  submitting.value = true
  activeReport.value = null
  try {
    const { data } = await api.analysis.start.post({
      symbol: symbol.value,
      type: 'SINGLE_STOCK',
    })
    if (data) {
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
  closeLogs()
  activeReport.value = task.result as AnalysisReport
  // Scroll to report smoothly
  setTimeout(() => {
    document.getElementById('analysis-report-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 100)
}

function viewLogs(taskId: string) {
  activeReport.value = null
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

function closeLogs() {
  activeTaskId.value = ''
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

function closeReport() {
  activeReport.value = null
  symbol.value = ''
}

// ─── Polling ───

const route = useRoute()

let interval: ReturnType<typeof setInterval>
onMounted(() => {
  fetchTasks()
  interval = setInterval(fetchTasks, 5000) // Poll more frequently for snappier UI updates
  // If navigated from Watchlist with ?symbol=xxx, pre-fill and auto-start
  if (route.query.symbol) {
    symbol.value = route.query.symbol as string
    startAnalysis()
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
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-4xl mx-auto space-y-6 pb-12 w-full pt-4">
        
        <!-- Beat 1: Input -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-sparkles" class="size-5 text-primary" />
              <h3 class="font-semibold text-default">New Analysis</h3>
            </div>
            <p class="text-sm text-muted mt-1">
              Enter a stock symbol to fetch market data and run a comprehensive LLM analysis.
            </p>
          </template>
          
          <div class="flex flex-col sm:flex-row items-end gap-4">
            <UFormField label="Target Symbol" required class="flex-1 w-full">
              <UInput v-model="symbol" placeholder="e.g. sh.600000" size="lg" :disabled="submitting || !!activeTaskId" @keydown.enter="startAnalysis" />
            </UFormField>
            <UButton
              label="Start Analysis"
              icon="i-lucide-play"
              size="lg"
              :loading="submitting"
              :disabled="!symbol || !!activeTaskId"
              @click="startAnalysis"
              class="w-full sm:w-auto"
            />
          </div>
        </UCard>

        <!-- Beat 2: Live Console -->
        <UCard v-if="activeTaskId" class="transition-all duration-300 ring-1 ring-info/50 shadow-lg shadow-info/10">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-terminal" class="size-5 text-info animate-pulse" />
              <h3 class="font-semibold text-default">Analysis Progress — {{ activeTaskId }}</h3>
              <UButton v-if="!submitting" icon="i-lucide-x" variant="ghost" size="xs" class="ml-auto" @click="closeLogs" />
            </div>
          </template>
          <div class="bg-gray-950 p-4 h-80 overflow-y-auto text-green-400 font-mono text-sm whitespace-pre-wrap rounded-lg flex flex-col">
            <div v-if="streamLogs.length === 0" class="text-gray-500 italic">Connecting to analysis stream...</div>
            <div v-for="(log, idx) in streamLogs" :key="idx" class="mb-1">{{ log }}</div>
            <div class="mt-auto pt-4 flex items-center gap-2 text-info opacity-70">
              <UIcon name="i-lucide-loader-2" class="animate-spin size-4" />
              <span>Working...</span>
            </div>
          </div>
        </UCard>

        <!-- Beat 3: Analysis Report -->
        <UCard id="analysis-report-card" v-if="activeReport" class="transition-all duration-500 shadow-xl ring-1 ring-primary/50 shadow-primary/10">
          <template #header>
            <div class="flex items-center gap-3">
              <div>
                <h3 class="text-xl font-bold text-default">
                  {{ activeReport.name }} <span class="text-muted font-normal text-base ml-1">{{ activeReport.symbol }}</span>
                </h3>
                <p class="text-sm text-muted">{{ activeReport.analysisDate }}</p>
              </div>
              <div class="ml-auto flex items-center gap-4">
                <div :class="['text-4xl font-bold', scoreColor(activeReport.overallScore)]">
                  {{ activeReport.overallScore }}
                </div>
                <UBadge
                  :color="(recommendationBadge[activeReport.recommendation] || 'neutral') as any"
                  :label="activeReport.recommendation"
                  size="lg"
                  class="px-3 py-1 text-sm"
                />
                <UButton icon="i-lucide-x" variant="ghost" color="neutral" @click="closeReport" />
              </div>
            </div>
          </template>

          <div class="space-y-6">
            <!-- Summary -->
            <UAlert icon="i-lucide-info" :description="activeReport.summary" color="primary" variant="subtle" class="text-base" />

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Trend -->
              <UCard class="h-full">
                <template #header>
                  <div class="flex items-center gap-2 font-semibold">
                    <UIcon :name="trendIcon[activeReport.trend.direction]" class="size-5" />
                    Trend — {{ activeReport.trend.direction }}
                    <UProgress class="ml-auto w-24" :value="activeReport.trend.strength * 100" size="sm" />
                  </div>
                </template>
                <p class="text-sm text-muted">{{ activeReport.trend.description }}</p>
              </UCard>

              <!-- Risk -->
              <UCard class="h-full">
                <template #header>
                  <div class="flex items-center gap-2 font-semibold">
                    <UIcon name="i-lucide-shield-alert" class="size-5" />
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

            <!-- Signals -->
            <div v-if="activeReport.signals?.length">
              <h4 class="font-semibold text-default mb-3 flex items-center gap-2">
                <UIcon name="i-lucide-activity" class="size-5" /> Signals
              </h4>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <UCard
                  v-for="(sig, i) in activeReport.signals"
                  :key="i"
                  class="p-4 flex flex-col justify-between"
                  :ui="{ body: { padding: '' } }"
                >
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs text-muted font-medium line-clamp-1" :title="sig.label">{{ sig.label }}</span>
                  </div>
                  <div class="flex items-end justify-between mt-auto">
                    <div class="text-xl font-bold text-default">{{ typeof sig.value === 'number' ? sig.value.toFixed(3) : sig.value }}</div>
                    <UBadge
                      :color="sig.sentiment === 'BULLISH' ? 'success' : sig.sentiment === 'BEARISH' ? 'error' : 'neutral'"
                      :label="sig.sentiment"
                      variant="subtle"
                      size="xs"
                    />
                  </div>
                </UCard>
              </div>
            </div>

            <!-- Alpha Factors -->
            <div v-if="activeReport.factors?.length">
              <h4 class="font-semibold text-default mb-3 flex items-center gap-2">
                <UIcon name="i-lucide-cpu" class="size-5" /> Supporting Alpha Factors
              </h4>
              <div class="space-y-2">
                <div
                  v-for="(f, i) in activeReport.factors"
                  :key="i"
                  class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm p-3 bg-gray-900 rounded-lg border border-gray-800"
                >
                  <code class="text-primary flex-1 break-all">{{ f.expression }}</code>
                  <div class="flex items-center gap-4 shrink-0 border-t sm:border-t-0 sm:border-l border-gray-800 pt-2 sm:pt-0 sm:pl-4">
                    <span class="text-muted"><span class="text-gray-500 mr-1">IC:</span>{{ f.icValue }}</span>
                    <span class="text-muted"><span class="text-gray-500 mr-1">ICIR:</span>{{ f.icir }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <UDivider class="py-8" />

        <!-- History -->
        <div>
          <h3 class="text-lg font-semibold text-default mb-4 flex items-center gap-2">
            <UIcon name="i-lucide-history" class="size-5" /> Analysis History
          </h3>
          <UCard :ui="{ body: { padding: '' } }">
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
                    label="View"
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
                  <UIcon name="i-lucide-history" class="size-10 mb-3 opacity-50" />
                  <p class="text-base">No analyses yet.</p>
                </div>
              </template>
            </UTable>
          </UCard>
        </div>

      </div>
    </template>
  </UDashboardPanel>
</template>
