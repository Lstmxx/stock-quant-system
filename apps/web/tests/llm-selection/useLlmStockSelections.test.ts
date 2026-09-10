import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLlmStockSelections } from '../../src/features/llm-selection/hooks/use-llm-stock-selections';
import { ApiCode } from '@stock-quant/api/contracts';
import { failureResponse, successResponse } from '../helpers/api-response';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock('../../src/api/api', () => {
  const selections = Object.assign(
    vi.fn(() => ({
      cancel: { post: mocks.cancel },
      'retry-failed': { post: mocks.retry },
    })),
    { get: mocks.list, post: mocks.create },
  );
  return { api: { 'llm-stock-selections': selections } };
});

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        success: mocks.messageSuccess,
        error: mocks.messageError,
      },
    }),
  },
}));

const emptyList = successResponse({ items: [], total: 0, limit: 20, offset: 0, activeTask: null });
const activeTask = {
  id: 'active-1', userId: 'user-1', type: 'LLM_STOCK_SELECTION', status: 'RUNNING',
  params: null, result: {}, createdAt: new Date(), updatedAt: new Date(),
};
const activeList = successResponse({ items: [activeTask], total: 1, limit: 20, offset: 0, activeTask });

describe('useLlmStockSelections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue(emptyList);
  });

  afterEach(() => vi.useRealTimers());

  it('keeps a failed create actionable and does not report success', async () => {
    mocks.create.mockResolvedValue(failureResponse('已有 LLM 选股任务正在执行', ApiCode.ACTIVE_TASK, 409));
    const { result } = renderHook(() => useLlmStockSelections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.list.mockResolvedValue(activeList);

    let created = true;
    await act(async () => {
      created = await result.current.createTask({
        llmModelId: 'model-1',
        candidateCount: 50,
        finalTopN: 10,
        lookbackDays: 250,
      });
    });

    expect(created).toBe(false);
    expect(mocks.messageError).toHaveBeenCalledWith('已有 LLM 选股任务正在执行');
    expect(mocks.messageSuccess).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(result.current.submitting).toBe(false);
    expect(result.current.activeTask?.id).toBe('active-1');
  });

  it('refreshes history after a successful create', async () => {
    mocks.create.mockResolvedValue(successResponse({ taskId: 'task-1' }));
    const { result } = renderHook(() => useLlmStockSelections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initialListCalls = mocks.list.mock.calls.length;

    await act(async () => {
      await result.current.createTask({
        llmModelId: 'model-1',
        candidateCount: 50,
        finalTopN: 10,
        lookbackDays: 250,
      });
    });

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(initialListCalls + 1);
    expect(mocks.messageSuccess).toHaveBeenCalledWith('LLM 选股任务已创建');
  });

  it('submits cooperative cancellation and refreshes status', async () => {
    mocks.cancel.mockResolvedValue(successResponse({ status: 'CANCELLING' }));
    const { result } = renderHook(() => useLlmStockSelections());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initialListCalls = mocks.list.mock.calls.length;

    await act(async () => {
      await result.current.cancelTask('task-1');
    });

    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(initialListCalls + 1);
    expect(mocks.messageSuccess).toHaveBeenCalledWith('取消请求已提交');
  });

  it('refreshes history and releases the row lock after a retry enqueue failure', async () => {
    mocks.retry.mockResolvedValue(failureResponse('入队失败', ApiCode.QUEUE_UNAVAILABLE, 503));
    const { result } = renderHook(() => useLlmStockSelections());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(await result.current.retryFailed('task-1', ['sh.600519'])).toBe(false);
    });

    expect(mocks.retry).toHaveBeenCalledWith({ symbols: ['sh.600519'] });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.messageError).toHaveBeenCalledTimes(1);
    expect(result.current.rowActionId).toBeNull();
  });

  it('ignores late list data after a newer refresh and releases loading', async () => {
    let finishFirst: ((value: unknown) => void) | undefined;
    mocks.list.mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }));
    const { result } = renderHook(() => useLlmStockSelections());

    await act(async () => { await result.current.fetchTasks(); });
    await act(async () => { finishFirst?.(activeList); });

    expect(result.current.tasks).toEqual([]);
    expect(result.current.activeTask).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('polls serially and stops when the task becomes terminal', async () => {
    vi.useFakeTimers();
    let finishPoll: ((value: unknown) => void) | undefined;
    mocks.list.mockResolvedValueOnce(activeList)
      .mockReturnValueOnce(new Promise((resolve) => { finishPoll = resolve; }))
      .mockResolvedValueOnce(emptyList);
    const { result, unmount } = renderHook(() => useLlmStockSelections());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.activeTask?.id).toBe('active-1');

    await act(async () => { vi.advanceTimersByTime(3_000); });
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await act(async () => { finishPoll?.(activeList); });
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(result.current.activeTask).toBeNull();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(mocks.list).toHaveBeenCalledTimes(3);
    unmount();
  });
});
