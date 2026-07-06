import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../../src/app/ProtectedRoute';
import { useAuthStore } from '../../src/features/auth/store';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/features/auth/store', () => ({
  useAuthStore: vi.fn(),
}));

const mockFetchSession = vi.fn();

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderRoute = (requireAuth = false, requireGuest = false) => {
    return render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={
            <ProtectedRoute requireAuth={requireAuth} requireGuest={requireGuest}>
              <div data-testid="protected-content">Content</div>
            </ProtectedRoute>
          } />
          <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page">Dashboard Page</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('shows loading state and fetches session if not ready', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      isReady: false,
      user: null,
      fetchSession: mockFetchSession,
      setUser: vi.fn(),
    });

    renderRoute();
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(mockFetchSession).toHaveBeenCalled();
  });

  it('redirects to login if requireAuth is true and user is null', async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      isReady: true,
      user: null,
      fetchSession: mockFetchSession,
      setUser: vi.fn(),
    });

    renderRoute(true, false);
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
  });

  it('redirects to dashboard if requireGuest is true and user exists', async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      isReady: true,
      user: { id: '1', name: 'Test', email: 'test@example.com', createdAt: new Date(), updatedAt: new Date() },
      fetchSession: mockFetchSession,
      setUser: vi.fn(),
    });

    renderRoute(false, true);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });

  it('renders children if requireAuth is true and user exists', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      isReady: true,
      user: { id: '1', name: 'Test', email: 'test@example.com', createdAt: new Date(), updatedAt: new Date() },
      fetchSession: mockFetchSession,
      setUser: vi.fn(),
    });

    renderRoute(true, false);
    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });
});
