import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: () => import('@/layouts/AuthLayout.vue'),
      meta: { guest: true },
      children: [
        {
          path: '',
          name: 'login',
          component: () => import('@/pages/Login.vue'),
        },
      ],
    },
    {
      path: '/',
      component: () => import('@/layouts/DashboardLayout.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/pages/Dashboard.vue'),
        },
        {
          path: 'config',
          name: 'config',
          component: () => import('@/pages/SystemConfig.vue'),
        },
        {
          path: 'watchlists',
          name: 'watchlists',
          component: () => import('@/pages/WatchlistManager.vue'),
        },
        {
          path: 'factors',
          name: 'factors',
          component: () => import('@/pages/FactorLibrary.vue'),
        },
        {
          path: 'analysis',
          name: 'analysis',
          component: () => import('@/pages/LlmAnalysis.vue'),
        },
        {
          path: 'strategy',
          name: 'strategy',
          component: () => import('@/pages/StrategyArchitect.vue'),
        },
      ],
    },
  ],
})

// Route guard: check auth state
router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  // Fetch session once on first navigation
  if (!authStore.isReady) {
    await authStore.fetchSession()
  }

  // Logged-in user trying to visit login → redirect to dashboard
  if (to.meta.guest && authStore.user) {
    return { name: 'dashboard' }
  }

  // Guest route → allow
  if (to.meta.guest) {
    return true
  }

  // Not logged in → redirect to login
  if (!authStore.user) {
    return { name: 'login' }
  }

  return true
})

export default router
