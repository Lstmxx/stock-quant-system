import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTaskLogsPolling } from '../../src/features/factor/hooks/useTaskLogsPolling';
import { api } from '../../src/api/api';

vi.mock('../../src/api/api', () => ({
  api: {
    tasks: vi.fn(),
  },
}));

const mockLogsGet = vi.fn();
(api.tasks as any).mockReturnValue({
  logs: {
    get: mockLogsGet,
  },
});

describe('useTaskLogsPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not poll if taskId is null', async () => {
    renderHook(() => useTaskLogsPolling(null, 10));
    await new Promise(r => setTimeout(r, 50));
    expect(mockLogsGet).not.toHaveBeenCalled();
  });

  it('should fetch logs initially and append new logs on polling', async () => {
    // Initial fetch
    mockLogsGet.mockResolvedValueOnce({
      data: { logs: ['{"message": "log1"}'], nextOffset: 1 },
    });
    // First poll
    mockLogsGet.mockResolvedValueOnce({
      data: { logs: ['{"message": "log2"}'], nextOffset: 2 },
    });
    // Second poll (no new logs)
    mockLogsGet.mockResolvedValue({
      data: { logs: [], nextOffset: 2 },
    });

    const { result } = renderHook(() => useTaskLogsPolling('task-1', 10));

    // Should fetch immediately
    expect(mockLogsGet).toHaveBeenCalled();
    expect(mockLogsGet).toHaveBeenCalledWith({ query: { offset: 0 } });
    
    await waitFor(() => {
      expect(result.current.logs).toEqual(['log1', 'log2']);
    });
  });

  it('should parse JSON logs safely', async () => {
    mockLogsGet.mockResolvedValueOnce({
      data: { logs: ['{"message": "hello"}', 'plain text', '{"other": "data"}'], nextOffset: 3 },
    });
    mockLogsGet.mockResolvedValue({
      data: { logs: [], nextOffset: 3 },
    });

    const { result } = renderHook(() => useTaskLogsPolling('task-1', 10));

    await waitFor(() => {
      expect(result.current.logs).toEqual(['hello', 'plain text', '{"other": "data"}']);
    });
  });
});
