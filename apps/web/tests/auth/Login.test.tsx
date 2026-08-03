import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../src/features/auth/Login';
import { App as AntdApp } from 'antd';
import { authClient } from '../../src/api/auth-client';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/api/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
  },
}));

vi.mock('../../src/features/auth/store', () => ({
  useAuthStore: () => ({ fetchSession: vi.fn() }),
}));

// Suppress matchMedia error from antd
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderLogin = () => render(
    <MemoryRouter>
      <AntdApp>
        <Login />
      </AntdApp>
    </MemoryRouter>
  );

  it('renders login form by default', () => {
    renderLogin();
    expect(screen.getByText('Welcome back!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('toggles to sign up mode', () => {
    renderLogin();
    fireEvent.click(screen.getByText('Sign up'));
    expect(screen.getByText('Create an account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
  });

  it('calls signIn when submitted in login mode', async () => {
    const signInMock = vi.mocked(authClient.signIn.email).mockResolvedValue({} as any);
    renderLogin();

    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith({ email: 'test@example.com', password: 'password123' });
    });
  });

  it('calls signUp when submitted in sign up mode', async () => {
    const signUpMock = vi.mocked(authClient.signUp.email).mockResolvedValue({} as any);
    renderLogin();

    fireEvent.click(screen.getByText('Sign up'));
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith({ 
        email: 'test@example.com', 
        password: 'password123',
        name: 'test'
      });
    });
  });
});
