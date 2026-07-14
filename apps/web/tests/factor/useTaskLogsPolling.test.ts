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
    renderHook(() => useTaskLogsPolling(null, undefined, 10));
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

    const { result } = renderHook(() => useTaskLogsPolling('task-1', 'RUNNING', 10));

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

    const { result } = renderHook(() => useTaskLogsPolling('task-1', 'RUNNING', 10));

    await waitFor(() => {
      expect(result.current.logs).toEqual(['hello', 'plain text', '{"other": "data"}']);
    });
  });

  it('should ignore a late response from the previously selected task', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    mockLogsGet.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    mockLogsGet.mockResolvedValue({ data: { logs: ['{"message":"new task"}'], nextOffset: 1 } });

    const { result, rerender } = renderHook(
      ({ taskId }) => useTaskLogsPolling(taskId, 'COMPLETED', 10),
      { initialProps: { taskId: 'task-1' } },
    );
    rerender({ taskId: 'task-2' });
    resolveFirst({ data: { logs: ['{"message":"old task"}'], nextOffset: 1 } });

    await waitFor(() => expect(result.current.logs).toEqual(['new task']));
  });

  it('should expose request failures and stop polling a terminal task', async () => {
    mockLogsGet.mockResolvedValue({ error: { value: 'failed' } });
    const { result } = renderHook(() => useTaskLogsPolling('task-1', 'FAILED', 10));

    await waitFor(() => expect(result.current.error).toBe('任务日志加载失败，请稍后重试'));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(mockLogsGet).toHaveBeenCalledTimes(1);
  });
});
