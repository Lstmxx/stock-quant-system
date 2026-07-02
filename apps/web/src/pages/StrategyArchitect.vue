<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../utils/api'

interface Factor {
  id: string
  name?: string
  expression: string
  icValue: number | string | null
}

interface SimulationResult {
  annualReturn: number
  maxDrawdown: number
  sharpeRatio: number
  winRate: number
}

interface RadarData {
  name: string
  value: number
}

interface StructuredReport {
  summary: string
  performanceAnalysis: string
  intuition: string
  riskWarning: string
  radarData?: RadarData[]
}

const styles = [
  { name: 'Momentum', desc: 'Capture trends and price inertia' },
  { name: 'Value', desc: 'Find undervalued assets with strong fundamentals' },
  { name: 'Volatility', desc: 'Exploit mean-reversion and market fear' },
]

const selectedStyle = ref<string>('')
const loadingFactors = ref(false)
const factors = ref<Factor[]>([])
const selectedFactor = ref<string>('')

const loadingSimulation = ref(false)
const simulationResult = ref<SimulationResult | null>(null)

const loadingReport = ref(false)
const structuredReport = ref<StructuredReport | null>(null)

async function selectStyle(styleName: string) {
  selectedStyle.value = styleName
  selectedFactor.value = ''
  simulationResult.value = null
  structuredReport.value = null

  loadingFactors.value = true
  const res = await api.strategy.recommend.post({ style: styleName })
  loadingFactors.value = false
  if (res.error) return
  factors.value = res.data as Factor[]
}

async function selectFactor(factorId: string) {
  selectedFactor.value = factorId
  structuredReport.value = null

  loadingSimulation.value = true
  const res = await api.strategy.simulate.post({ factorId })
  loadingSimulation.value = false
  if (res.error) return
  simulationResult.value = res.data as SimulationResult
}

async function generateReport() {
  if (!selectedFactor.value || !simulationResult.value) return
  structuredReport.value = null

  loadingReport.value = true
  const res = await api.strategy['generate-report'].post({
    style: selectedStyle.value,
    factorId: selectedFactor.value,
    simulationResult: simulationResult.value,
  })
  loadingReport.value = false
  if (res.error) return
  structuredReport.value = res.data as StructuredReport
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Strategy Architect">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-4xl mx-auto space-y-6 pb-12 w-full pt-4">

        <!-- Beat 1: Style Selection -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-compass" class="size-5 text-primary" />
              <h3 class="font-semibold text-default">1. Select Strategy Style</h3>
            </div>
            <p class="text-sm text-muted mt-1">
              What is the primary driver of returns you want to capture?
            </p>
          </template>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <UCard
              v-for="style in styles"
              :key="style.name"
              class="cursor-pointer transition-all duration-200"
              :class="selectedStyle === style.name ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/50'"
              @click="selectStyle(style.name)"
            >
              <div class="font-medium text-default">{{ style.name }}</div>
              <div class="text-xs text-muted mt-1">{{ style.desc }}</div>
            </UCard>
          </div>
        </UCard>

        <!-- Beat 2: Factor Recommendation -->
        <UCard v-if="selectedStyle">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-cpu" class="size-5 text-primary" />
              <h3 class="font-semibold text-default">2. Factor Recommendations</h3>
            </div>
          </template>

          <div v-if="loadingFactors" class="flex justify-center p-4">
            <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
          </div>
          <div v-else-if="factors.length === 0" class="text-muted text-sm">
            No factors found for this style. Please generate some in the Factor Library.
          </div>
          <div v-else class="space-y-4">
            <p class="text-muted text-sm">
              I found these top-performing factors that align with {{ selectedStyle }}.
            </p>
            <div class="grid grid-cols-1 gap-3">
              <UCard
                v-for="factor in factors"
                :key="factor.id"
                class="cursor-pointer transition-all duration-200"
                :class="selectedFactor === factor.id ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/50'"
                @click="selectFactor(factor.id)"
              >
                <div class="flex justify-between items-start">
                  <div>
                    <div class="font-medium text-default">{{ factor.name || 'Unnamed Factor' }}</div>
                    <code class="text-xs text-primary mt-1">{{ factor.expression }}</code>
                  </div>
                  <div class="text-right">
                    <UBadge color="success" variant="subtle" :label="`IC: ${Number(factor.icValue).toFixed(4)}`" />
                  </div>
                </div>
              </UCard>
            </div>
          </div>
        </UCard>

        <!-- Beat 3: Simulation & Reporting -->
        <UCard v-if="selectedFactor">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-bar-chart-2" class="size-5 text-primary" />
              <h3 class="font-semibold text-default">3. Backtest & Review</h3>
            </div>
          </template>

          <div v-if="loadingSimulation" class="flex items-center gap-3 text-primary p-4">
            <UIcon name="i-lucide-loader-2" class="animate-spin size-5" />
            <span class="text-sm font-medium">Running historical simulation...</span>
          </div>
          <div v-else-if="simulationResult" class="space-y-6">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div class="p-4 bg-elevated rounded-lg">
                <div class="text-xs text-muted">Annual Return</div>
                <div class="text-lg font-semibold text-success">{{ (simulationResult.annualReturn * 100).toFixed(2) }}%</div>
              </div>
              <div class="p-4 bg-elevated rounded-lg">
                <div class="text-xs text-muted">Max Drawdown</div>
                <div class="text-lg font-semibold text-error">{{ (simulationResult.maxDrawdown * 100).toFixed(2) }}%</div>
              </div>
              <div class="p-4 bg-elevated rounded-lg">
                <div class="text-xs text-muted">Sharpe Ratio</div>
                <div class="text-lg font-semibold text-default">{{ simulationResult.sharpeRatio.toFixed(2) }}</div>
              </div>
              <div class="p-4 bg-elevated rounded-lg">
                <div class="text-xs text-muted">Win Rate</div>
                <div class="text-lg font-semibold text-default">{{ (simulationResult.winRate * 100).toFixed(2) }}%</div>
              </div>
            </div>

            <div class="flex justify-end">
              <UButton
                label="Generate Final Strategy Report"
                icon="i-lucide-sparkles"
                :loading="loadingReport"
                @click="generateReport"
              />
            </div>
          </div>
        </UCard>

        <!-- Final Report Output -->
        <template v-if="structuredReport">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-file-text" class="size-5 text-primary" />
                <h3 class="font-semibold text-default">Final Strategy Report</h3>
                <UBadge color="primary" variant="subtle" label="Generated by AI" size="xs" />
              </div>
            </template>

            <div class="space-y-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 class="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Core Summary</h4>
                  <p class="text-lg text-default font-medium">{{ structuredReport.summary }}</p>
                </div>
                <div>
                  <h4 class="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Performance Evaluation</h4>
                  <p class="text-sm text-muted leading-relaxed">{{ structuredReport.performanceAnalysis }}</p>
                </div>
              </div>

              <UDivider />

              <div>
                <h4 class="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Economic Intuition & Logic</h4>
                <p class="text-sm text-muted leading-relaxed">{{ structuredReport.intuition }}</p>
              </div>

              <UAlert
                icon="i-lucide-triangle-alert"
                color="error"
                variant="subtle"
                title="Risk Warnings"
                :description="structuredReport.riskWarning"
              />

              <!-- Factor Dimensions -->
              <div v-if="structuredReport.radarData?.length">
                <h4 class="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Factor Dimensions</h4>
                <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div
                    v-for="item in structuredReport.radarData"
                    :key="item.name"
                    class="flex flex-col items-center p-3 bg-elevated rounded-lg"
                  >
                    <span class="text-xs text-muted mb-1">{{ item.name }}</span>
                    <span
                      class="text-xl font-bold"
                      :class="item.value >= 80 ? 'text-success' : (item.value >= 60 ? 'text-primary' : 'text-warning')"
                    >{{ item.value }}</span>
                  </div>
                </div>
              </div>
            </div>
          </UCard>
        </template>

      </div>
    </template>
  </UDashboardPanel>
</template>
