<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '../utils/api'

interface ConfigItem {
  id: string
  key: string
  value: string
}

const configs = ref<ConfigItem[]>([])
const loading = ref(true)
const saving = ref(false)

// Config fields we want to manage
const configFields = [
  { key: 'LLM_API_KEY', label: 'LLM API Key', placeholder: 'sk-...', type: 'password' },
  { key: 'LLM_MODEL', label: 'LLM Model', placeholder: 'e.g. gpt-4o', type: 'text' },
  { key: 'LLM_BASE_URL', label: 'LLM Base URL', placeholder: 'https://api.openai.com/v1', type: 'text' },
  { key: 'BAOSTOCK_CRON', label: 'Baostock Sync Cron', placeholder: '0 12 * * 1-5', type: 'text', description: 'Schedule to sync daily data to Redis.' },
]

const formState = ref<Record<string, string>>({})

async function fetchConfigs() {
  loading.value = true
  try {
    const { data } = await api.config.get()
    if (data) {
      configs.value = data as ConfigItem[]
      // Populate form state from existing configs
      for (const config of configs.value) {
        formState.value[config.key] = config.value
      }
    }
  } finally {
    loading.value = false
  }
}

async function saveConfig(key: string) {
  const value = formState.value[key]
  if (value === undefined) return

  saving.value = true
  try {
    await api.config.post({ key, value })
  } finally {
    saving.value = false
  }
}

async function saveAll() {
  saving.value = true
  try {
    for (const field of configFields) {
      const value = formState.value[field.key]
      if (value !== undefined && value !== '') {
        await api.config.post({ key: field.key, value })
      }
    }
    await fetchConfigs()
  } finally {
    saving.value = false
  }
}

onMounted(fetchConfigs)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton label="Save All" icon="i-lucide-save" :loading="saving" @click="saveAll" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl mx-auto space-y-6 p-4" v-if="!loading">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-bot" class="size-5 text-primary" />
              <h3 class="text-base font-semibold text-default">LLM Configuration</h3>
            </div>
            <p class="mt-1 text-sm text-muted">Configure the AI model used for stock analysis.</p>
          </template>

          <div class="space-y-4">
            <UFormField v-for="field in configFields" :key="field.key" :label="field.label" :description="field.description">
              <UInput
                v-model="formState[field.key]"
                :type="field.type as any"
                :placeholder="field.placeholder"
              />
            </UFormField>
          </div>
        </UCard>
      </div>

      <div v-else class="flex items-center justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
      </div>
    </template>
  </UDashboardPanel>
</template>
