import { render, screen } from '@testing-library/react';
import Dashboard from '../../src/features/dashboard/Dashboard';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/api/api', () => ({
  api: {
    tasks: {
      get: vi.fn().mockResolvedValue({ data: [] }),
      mining: {
        post: vi.fn(),
      }
    }
  }
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

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dashboard with new analysis button', () => {
    render(<Dashboard />);
    expect(screen.getByText('Analysis Dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Analysis/i })).toBeInTheDocument();
  });
});
