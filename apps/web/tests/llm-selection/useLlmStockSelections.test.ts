import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLlmStockSelections } from '../../src/features/llm-selection/hooks/use-llm-stock-selections';

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

const emptyList = {
  data: { items: [], total: 0, limit: 20, offset: 0, activeTask: null },
};

describe('useLlmStockSelections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue(emptyList);
  });

  it('keeps a failed create actionable and does not report success', async () => {
    mocks.create.mockResolvedValue({
      error: { value: { error: '已有 LLM 选股任务正在执行' } },
    });
    const { result } = renderHook(() => useLlmStockSelections());
    await waitFor(() => expect(result.current.loading).toBe(false));

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
  });

  it('refreshes history after a successful create', async () => {
    mocks.create.mockResolvedValue({ data: { taskId: 'task-1' } });
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
    mocks.cancel.mockResolvedValue({ data: { success: true, status: 'CANCELLING' } });
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
});
