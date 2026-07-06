import { create } from 'zustand'
import { authClient } from '../../api/auth-client'

interface AuthUser {
  id: string
  name: string
  email: string
  image?: string | null
  createdAt: Date
  updatedAt: Date
}

interface AuthState {
  user: AuthUser | null
  isReady: boolean
  fetchSession: () => Promise<void>
  setUser: (user: AuthUser | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isReady: false,
  fetchSession: async () => {
    try {
      const { data } = await authClient.getSession()
      if (data?.user) {
        set({ user: data.user as AuthUser })
      } else {
        set({ user: null })
      }
    } catch {
      set({ user: null })
    } finally {
      set({ isReady: true })
    }
  },
  setUser: (user) => set({ user }),
}))
