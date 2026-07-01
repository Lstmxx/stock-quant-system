import './assets/css/main.css'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import { authClient } from './utils/auth-client'

// Import pages
import Dashboard from './pages/Dashboard.vue'
import Login from './pages/Login.vue'
import SystemConfig from './pages/SystemConfig.vue'
import WatchlistManager from './pages/WatchlistManager.vue'
import FactorLibrary from './pages/FactorLibrary.vue'
import LlmAnalysis from './pages/LlmAnalysis.vue'
import StrategyArchitect from './pages/StrategyArchitect.vue'

const app = createApp(App)
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/login', component: Login, meta: { guest: true } },
    { path: '/config', component: SystemConfig },
    { path: '/watchlists', component: WatchlistManager },
    { path: '/factors', component: FactorLibrary },
    { path: '/analysis', component: LlmAnalysis },
    { path: '/strategy', component: StrategyArchitect }
  ]
})

// Route guard: redirect to /login if not authenticated
router.beforeEach(async (to) => {
  if (to.meta.guest) return true

  const { data: session } = await authClient.getSession()
  if (!session) return '/login'
  return true
})

app.use(router)
app.use(ui)
app.mount('#app')
