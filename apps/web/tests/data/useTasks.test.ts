import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { ApiCode } from '@stock-quant/api/contracts';
import { useTasks } from '../../src/features/data/hooks/useTasks';
import { failureResponse, successResponse } from '../helpers/api-response';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../../src/api/api', () => {
  const tasks = Object.assign(
    vi.fn(() => ({ cancel: { post: mocks.cancel } })),
    {
      'data-collection': {
        get: mocks.list,
        run: { post: mocks.run },
      },
    },
  );
  return { api: { tasks } };
});

vi.mock('antd', () => {
  const messageApi = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  };
  return { message: messageApi, App: { useApp: () => ({ message: messageApi }) } };
});

const activeTask = {
  id: 'task-1',
  userId: 'user-1',
  type: 'DATA_COLLECTION',
  status: 'CANCELLING',
  params: { trigger: 'MANUAL' },
  result: null,
  createdAt: '2026-07-14T00:00:00Z',
  updatedAt: '2026-07-14T00:00:00Z',
};

describe('useTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue(successResponse({ items: [], total: 0, limit: 10, offset: 0, activeTask: null }));
  });

  it('treats CANCELLING as active and blocks duplicate collection', async () => {
    mocks.list.mockResolvedValue(successResponse({ items: [], total: 1, limit: 10, offset: 10, activeTask }));
    const { result } = renderHook(() => useTasks());

    await waitFor(() => expect(result.current.activeTask?.id).toBe('task-1'));
    await act(async () => { await result.current.handleRunNow(); });

    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('reports cancellation as submitted until the worker reaches a terminal state', async () => {
    mocks.cancel.mockResolvedValue(successResponse({ status: 'CANCELLING' }));
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.handleCancelTask('task-1'); });

    expect(message.success).toHaveBeenCalledWith('取消请求已提交');
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: ApiCode.ACTIVE_TASK, status: 409 },
    { code: ApiCode.QUEUE_UNAVAILABLE, status: 503 },
  ])('refreshes task identity after a $status command failure', async ({ code, status }) => {
    mocks.run.mockResolvedValue(failureResponse('任务未启动', code, status));
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const listedTask = { ...activeTask, status: status === 409 ? 'CANCELLING' : 'FAILED' };
    const listedActiveTask = status === 409 ? listedTask : null;
    mocks.list.mockResolvedValue(successResponse({ items: [listedTask], total: 1, activeTask: listedActiveTask }));

    await act(async () => { await result.current.handleRunNow(); });

    expect(result.current.tasks).toEqual([listedTask]);
    expect(result.current.activeTask).toEqual(listedActiveTask);
    expect(result.current.running).toBe(false);
    expect(message.error).toHaveBeenCalledTimes(1);
    expect(message.success).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});
