import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStream } from '../../src/features/data/hooks/useTaskStream';

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
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
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
    }), { status: 200 }));

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
      resolveRequest?.(new Response(JSON.stringify({
        taskId: 'task-1', status: 'RUNNING', workers: [],
      }), { status: 200 }));
      await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
