import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCode } from '@stock-quant/api/contracts';
import { TaskDetailModal } from '../../src/features/data/components/TaskDetailModal';
import { failureResponse, successResponse } from '../helpers/api-response';

const mocks = vi.hoisted(() => ({
  failed: vi.fn(), retry: vi.fn(), success: vi.fn(), error: vi.fn(),
}));

vi.mock('../../src/api/api', () => ({
  api: { tasks: vi.fn(() => ({
    'failed-stocks': { get: mocks.failed },
    'retry-failed': { post: mocks.retry },
  })) },
}));

vi.mock('../../src/features/data/hooks/useTaskStream', () => ({
  useTaskStream: () => ({ workers: {}, error: null }),
}));

vi.mock('antd', async (loadActual) => {
  const actual = await loadActual<typeof import('antd')>();
  return { ...actual, App: { useApp: () => ({ message: { success: mocks.success, error: mocks.error } }) } };
});

const task = {
  id: 'task-1', userId: 'user-1', type: 'DATA_COLLECTION', status: 'PARTIAL_SUCCESS', params: null,
  result: { failedCount: 2 }, createdAt: new Date(), updatedAt: new Date(),
};

describe('collection retry modal response contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    const getComputedStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    mocks.failed.mockResolvedValue(successResponse({
      taskId: task.id, stocks: ['sh.600519', 'sz.000001'],
      failures: [{ code: 'sh.600519', reason: 'timeout' }, { code: 'sz.000001', reason: 'timeout' }],
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('delivers the unwrapped retry task ID and stock count before closing', async () => {
    mocks.retry.mockResolvedValue(successResponse({ taskId: 'retry-2', stockCount: 2 }));
    const onCancel = vi.fn();
    const onRetryCreated = vi.fn();
    render(<TaskDetailModal task={task} activeTaskId={null} open onCancel={onCancel} onRetryCreated={onRetryCreated} />);

    fireEvent.click(await screen.findByRole('button', { name: '一键重试' }));

    await waitFor(() => expect(onRetryCreated).toHaveBeenCalledWith('retry-2'));
    expect(mocks.success).toHaveBeenCalledWith('已创建重试任务，共 2 只股票');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    { code: ApiCode.ACTIVE_TASK, status: 409 },
    { code: ApiCode.QUEUE_UNAVAILABLE, status: 503 },
  ])('keeps the modal open and refreshes history after HTTP $status', async ({ code, status }) => {
    mocks.retry.mockResolvedValue(failureResponse('暂时无法重试', code, status));
    const onCancel = vi.fn();
    const onRetryFailed = vi.fn();
    render(<TaskDetailModal task={task} activeTaskId={null} open onCancel={onCancel} onRetryFailed={onRetryFailed} />);

    fireEvent.click(await screen.findByRole('button', { name: '一键重试' }));

    await waitFor(() => expect(onRetryFailed).toHaveBeenCalledTimes(1));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
