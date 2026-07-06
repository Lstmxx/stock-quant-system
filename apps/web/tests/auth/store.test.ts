import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '../../src/features/auth/store';
import { authClient } from '../../src/api/auth-client';

vi.mock('../../src/api/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
  }
}))

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: null, isReady: false })
  })

  it('should initialize with default state', () => {
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.isReady).toBe(false)
  })

  it('fetchSession should set user when session exists', async () => {
    const mockUser = { id: '1', name: 'Test', email: 'test@example.com', createdAt: new Date(), updatedAt: new Date() };
    (authClient.getSession as any).mockResolvedValue({ data: { user: mockUser } })
    
    const state = useAuthStore.getState()
    await state.fetchSession()
    
    const updatedState = useAuthStore.getState()
    expect(updatedState.user).toEqual(mockUser)
    expect(updatedState.isReady).toBe(true)
  })

  it('fetchSession should handle errors', async () => {
    (authClient.getSession as any).mockRejectedValue(new Error('Network error'))
    
    const state = useAuthStore.getState()
    await state.fetchSession()
    
    const updatedState = useAuthStore.getState()
    expect(updatedState.user).toBeNull()
    expect(updatedState.isReady).toBe(true)
  })
})
