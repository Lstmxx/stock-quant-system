<template>
  <div class="h-full flex flex-col p-6 max-w-4xl mx-auto space-y-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Interactive Strategy Architect</h1>
        <p class="text-sm text-gray-500 mt-1">Design your quantitative strategy step-by-step.</p>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto space-y-8 pr-4">
      <!-- Beat 1: Style Selection -->
      <div class="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 class="text-xl font-semibold mb-4 text-gray-900 dark:text-white">1. Select Strategy Style</h2>
        <p class="text-gray-600 dark:text-gray-400 mb-4 text-sm">
          What is the primary driver of returns you want to capture?
        </p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button 
            v-for="style in styles" 
            :key="style.name"
            @click="selectStyle(style.name)"
            :class="[
              'p-4 rounded-lg border text-left transition-all duration-200',
              selectedStyle === style.name 
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-2 ring-indigo-500/20' 
                : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700'
            ]"
          >
            <div class="font-medium text-gray-900 dark:text-white">{{ style.name }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ style.desc }}</div>
          </button>
        </div>
      </div>

      <!-- Beat 2: Factor Recommendation -->
      <div v-if="selectedStyle" class="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h2 class="text-xl font-semibold mb-4 text-gray-900 dark:text-white">2. Factor Recommendations</h2>
        <div v-if="loadingFactors" class="flex justify-center p-4">
          <div class="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
        </div>
        <div v-else-if="factors.length === 0" class="text-gray-500 text-sm">
          No factors found for this style. Please generate some in the Factor Library.
        </div>
        <div v-else class="space-y-4">
          <p class="text-gray-600 dark:text-gray-400 text-sm">
            I found these top-performing factors that align with {{ selectedStyle }}.
          </p>
          <div class="grid grid-cols-1 gap-3">
            <div 
              v-for="factor in factors" 
              :key="factor.id"
              @click="selectFactor(factor.id)"
              :class="[
                'p-4 rounded-lg border cursor-pointer transition-all duration-200',
                selectedFactor === factor.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-2 ring-indigo-500/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700'
              ]"
            >
              <div class="flex justify-between items-start">
                <div>
                  <div class="font-medium text-gray-900 dark:text-white">{{ factor.name || 'Unnamed Factor' }}</div>
                  <div class="text-xs text-gray-500 font-mono mt-1">{{ factor.expression }}</div>
                </div>
                <div class="text-right">
                  <div class="text-sm font-semibold text-emerald-600 dark:text-emerald-400">IC: {{ Number(factor.icValue).toFixed(4) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Beat 3: Simulation & Reporting -->
      <div v-if="selectedFactor" class="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h2 class="text-xl font-semibold mb-4 text-gray-900 dark:text-white">3. Backtest & Review</h2>
        <div v-if="loadingSimulation" class="flex items-center space-x-3 text-indigo-600 p-4">
          <div class="animate-spin h-5 w-5 border-2 border-current border-t-transparent rounded-full"></div>
          <span class="text-sm font-medium">Running historical simulation...</span>
        </div>
        <div v-else-if="simulationResult" class="space-y-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
            <div>
              <div class="text-xs text-gray-500">Annual Return</div>
              <div class="text-lg font-semibold text-emerald-600">{{ (simulationResult.annualReturn * 100).toFixed(2) }}%</div>
            </div>
            <div>
              <div class="text-xs text-gray-500">Max Drawdown</div>
              <div class="text-lg font-semibold text-rose-600">{{ (simulationResult.maxDrawdown * 100).toFixed(2) }}%</div>
            </div>
            <div>
              <div class="text-xs text-gray-500">Sharpe Ratio</div>
              <div class="text-lg font-semibold text-gray-900 dark:text-white">{{ simulationResult.sharpeRatio.toFixed(2) }}</div>
            </div>
            <div>
              <div class="text-xs text-gray-500">Win Rate</div>
              <div class="text-lg font-semibold text-gray-900 dark:text-white">{{ (simulationResult.winRate * 100).toFixed(2) }}%</div>
            </div>
          </div>
          
          <div class="flex justify-end">
            <button 
              @click="generateReport"
              :disabled="loadingReport"
              class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center space-x-2"
            >
              <div v-if="loadingReport" class="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
              <span>{{ loadingReport ? 'Drafting Report...' : 'Generate Final Strategy Report' }}</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Final Report Output -->
      <div v-if="finalReport" class="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-indigo-100 dark:border-indigo-900/50 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h2 class="text-xl font-semibold mb-4 text-indigo-900 dark:text-indigo-100 flex items-center space-x-2">
          <span>Final Strategy Report</span>
          <span class="px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">Generated</span>
        </h2>
        <div class="prose dark:prose-invert max-w-none text-sm" v-html="formattedReport"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '../utils/api';
import { marked } from 'marked';

const styles = [
  { name: 'Momentum', desc: 'Capture trends and price inertia' },
  { name: 'Value', desc: 'Find undervalued assets with strong fundamentals' },
  { name: 'Volatility', desc: 'Exploit mean-reversion and market fear' }
];

const selectedStyle = ref<string>('');
const loadingFactors = ref(false);
const factors = ref<any[]>([]);
const selectedFactor = ref<string>('');

const loadingSimulation = ref(false);
const simulationResult = ref<any>(null);

const loadingReport = ref(false);
const finalReport = ref<string>('');

const formattedReport = computed(() => {
  if (!finalReport.value) return '';
  return marked.parse(finalReport.value);
});

async function selectStyle(styleName: string) {
  selectedStyle.value = styleName;
  selectedFactor.value = '';
  simulationResult.value = null;
  finalReport.value = '';
  
  loadingFactors.value = true;
  try {
    const res = await api.strategy.recommend.post({ style: styleName });
    if (res.error) throw res.error;
    factors.value = res.data;
  } catch (err) {
    console.error(err);
    alert('Failed to get factor recommendations');
  } finally {
    loadingFactors.value = false;
  }
}

async function selectFactor(factorId: string) {
  selectedFactor.value = factorId;
  finalReport.value = '';
  
  loadingSimulation.value = true;
  try {
    const res = await api.strategy.simulate.post({ factorId });
    if (res.error) throw res.error;
    simulationResult.value = res.data;
  } catch (err) {
    console.error(err);
    alert('Failed to simulate factor');
  } finally {
    loadingSimulation.value = false;
  }
}

async function generateReport() {
  loadingReport.value = true;
  finalReport.value = '';
  try {
    const response = await fetch('http://localhost:3000/strategy/generate-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        style: selectedStyle.value,
        factorId: selectedFactor.value,
        simulationResult: simulationResult.value
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // The Elysia stream sends data prefixed with "data: " 
        // but wait, we yielded just raw text in the async generator.
        // Let's check: in StrategyService, we yielded `text`, and Elysia Stream wraps it in `data: ${yielded}\n\n`.
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const text = line.slice(6);
            if (text && text !== '[DONE]') {
              finalReport.value += text;
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(err);
    alert('Failed to generate report. Have you configured the LLM API key?');
  } finally {
    loadingReport.value = false;
  }
}
</script>
