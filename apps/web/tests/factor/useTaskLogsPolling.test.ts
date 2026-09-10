import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTaskLogsPolling } from '../../src/features/factor/hooks/useTaskLogsPolling';
import { failureResponse, successResponse } from '../helpers/api-response';

const mocks = vi.hoisted(() => ({ logs: vi.fn() }));

vi.mock('../../src/api/api', () => ({
  api: {
    tasks: vi.fn(() => ({ logs: { get: mocks.logs } })),
  },
}));

const mockLogsGet = mocks.logs;

describe('useTaskLogsPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not poll if taskId is null', async () => {
    renderHook(() => useTaskLogsPolling(null, undefined, 10));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockLogsGet).not.toHaveBeenCalled();
  });

  it('should fetch logs initially and append new logs on polling', async () => {
    // Initial fetch
    mockLogsGet.mockResolvedValueOnce(successResponse({ logs: ['{"message": "log1"}'], nextOffset: 1 }));
    // First poll
    mockLogsGet.mockResolvedValueOnce(successResponse({ logs: ['{"message": "log2"}'], nextOffset: 2 }));
    // Second poll (no new logs)
    mockLogsGet.mockResolvedValue(successResponse({ logs: [], nextOffset: 2 }));

    const { result } = renderHook(() => useTaskLogsPolling('task-1', 'RUNNING', 10));

    // Should fetch immediately
    expect(mockLogsGet).toHaveBeenCalled();
    expect(mockLogsGet).toHaveBeenCalledWith({ query: { offset: 0 } });
    
    await waitFor(() => {
      expect(result.current.logs).toEqual(['log1', 'log2']);
    });
  });

  it('should parse JSON logs safely', async () => {
    mockLogsGet.mockResolvedValueOnce(successResponse({ logs: ['{"message": "hello"}', 'plain text', '{"other": "data"}'], nextOffset: 3 }));
    mockLogsGet.mockResolvedValue(successResponse({ logs: [], nextOffset: 3 }));

    const { result } = renderHook(() => useTaskLogsPolling('task-1', 'RUNNING', 10));

    await waitFor(() => {
      expect(result.current.logs).toEqual(['hello', 'plain text', '{"other": "data"}']);
    });
  });

  it('should ignore a late response from the previously selected task', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    mockLogsGet.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    mockLogsGet.mockResolvedValue(successResponse({ logs: ['{"message":"new task"}'], nextOffset: 1 }));

    const { result, rerender } = renderHook(
      ({ taskId }) => useTaskLogsPolling(taskId, 'COMPLETED', 10),
      { initialProps: { taskId: 'task-1' } },
    );
    rerender({ taskId: 'task-2' });
    resolveFirst(successResponse({ logs: ['{"message":"old task"}'], nextOffset: 1 }));

    await waitFor(() => expect(result.current.logs).toEqual(['new task']));
  });

  it('should expose request failures and stop polling a terminal task', async () => {
    mockLogsGet.mockResolvedValue(failureResponse('任务日志加载失败，请稍后重试'));
    const { result } = renderHook(() => useTaskLogsPolling('task-1', 'FAILED', 10));

    await waitFor(() => expect(result.current.error).toBe('任务日志加载失败，请稍后重试'));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(mockLogsGet).toHaveBeenCalledTimes(1);
  });
});
