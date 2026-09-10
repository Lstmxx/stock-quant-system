import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStream } from '../../src/features/data/hooks/useTaskStream';
import { jsonSuccessResponse } from '../helpers/api-response';

describe('useTaskStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves failed worker state instead of displaying success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonSuccessResponse({
      taskId: 'task-1',
      status: 'PARTIAL_SUCCESS',
      workers: [{
        worker_id: 1,
        total: 2,
        success: 0,
        failed: 2,
        current_code: null,
        status: 'failed',
      }],
    }));

    const { result } = renderHook(() => useTaskStream('task-1'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.workers[1]).toBeDefined();
    expect(result.current.workers[1].status).toBe('failed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not overlap progress requests while the previous request is pending', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    renderHook(() => useTaskStream('task-1'));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest?.(jsonSuccessResponse({
        taskId: 'task-1', status: 'RUNNING', workers: [],
      }));
      await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves credentials, aborts replaced polling, and ignores late results', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(jsonSuccessResponse({
        taskId: 'task-2', status: 'COMPLETED', workers: [{
          worker_id: 2, total: 1, success: 1, failed: 0, current_code: null, status: 'completed',
        }],
      }));
    const { result, rerender } = renderHook(({ taskId }) => useTaskStream(taskId), {
      initialProps: { taskId: 'task-1' },
    });
    await act(async () => { await Promise.resolve(); });
    const options = vi.mocked(fetch).mock.calls[0][1];
    expect(options?.credentials).toBe('include');

    rerender({ taskId: 'task-2' });
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => {
      resolveFirst?.(jsonSuccessResponse({ taskId: 'task-1', status: 'RUNNING', workers: [] }));
    });
    expect(result.current.workers[2]?.status).toBe('completed');
    expect(result.current.error).toBeNull();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
