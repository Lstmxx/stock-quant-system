import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authClient } from '../utils/auth-client'

interface AuthUser {
  id: string
  name: string
  email: string
  image?: string | null
  createdAt: Date
  updatedAt: Date
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const isReady = ref(false)

  async function fetchSession() {
    try {
      const { data } = await authClient.getSession()
      if (data?.user) {
        user.value = data.user as AuthUser
      } else {
        user.value = null
      }
    } catch {
      user.value = null
    } finally {
      isReady.value = true
    }
  }

  function setUser(newUser: AuthUser | null) {
    user.value = newUser
  }

  return {
    user,
    isReady,
    fetchSession,
    setUser,
  }
})
