import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFactorTasks } from '../../src/features/factor/hooks/useFactorTasks';
import { api } from '../../src/api/api';
import { message } from 'antd';
import { failureResponse, successResponse } from '../helpers/api-response';

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), cancel: vi.fn() }));

vi.mock('../../src/api/api', () => ({
  api: {
    tasks: Object.assign(vi.fn(() => ({ cancel: { post: mocks.cancel } })), {
      get: mocks.list,
      mining: { post: mocks.create },
    }),
  },
}));

vi.mock('antd', () => {
  const messageApi = {
    success: vi.fn(),
    error: vi.fn(),
  };
  return { message: messageApi, App: { useApp: () => ({ message: messageApi }) } };
});

describe('useFactorTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch and filter only FACTOR_MINING tasks', async () => {
    const mockTasks = [
      { id: '1', type: 'DATA_COLLECTION', createdAt: '2023-01-01' },
      { id: '2', type: 'FACTOR_MINING', createdAt: '2023-01-02' },
      { id: '3', type: 'FACTOR_MINING', createdAt: '2023-01-01' },
    ];
    mocks.list.mockResolvedValue(successResponse(mockTasks));

    const { result } = renderHook(() => useFactorTasks());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should filter out DATA_COLLECTION and sort by createdAt desc
    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks[0].id).toBe('2'); // newer
    expect(result.current.tasks[1].id).toBe('3'); // older
  });

  it('should handle fetch tasks error', async () => {
    mocks.list.mockResolvedValue(failureResponse('获取任务列表失败'));

    const { result } = renderHook(() => useFactorTasks());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(message.error).toHaveBeenCalledWith('获取任务列表失败');
    expect(result.current.tasks).toEqual([]);
  });

  it('handleCreateTask should call api and refetch on success', async () => {
    mocks.list.mockResolvedValue(successResponse([]));
    mocks.create.mockResolvedValue(successResponse({ taskId: 'new-task' }));

    const { result } = renderHook(() => useFactorTasks());

    await act(async () => {
      await result.current.handleCreateTask('动量反转', 100);
    });

    expect(api.tasks.mining.post).toHaveBeenCalledWith({ researchDirection: '动量反转', days: 100 });
    expect(message.success).toHaveBeenCalledWith('已触发挖掘任务');
    expect(api.tasks.get).toHaveBeenCalledTimes(2); // Initial mount + after create
  });

  it('handleCreateTask should show error on failure', async () => {
    mocks.list.mockResolvedValue(successResponse([]));
    mocks.create.mockResolvedValue(failureResponse('触发失败，请重试'));

    const { result } = renderHook(() => useFactorTasks());

    await act(async () => {
      await result.current.handleCreateTask('量价关系', 250);
    });

    expect(message.error).toHaveBeenCalledWith('触发失败，请重试');
  });

  it('handleCancelTask should call api and refetch on success', async () => {
    mocks.list.mockResolvedValue(successResponse([]));
    mocks.cancel.mockResolvedValue(successResponse({ status: 'CANCELLING' }));

    const { result } = renderHook(() => useFactorTasks());

    await act(async () => {
      await result.current.handleCancelTask('task-1');
    });

    expect(api.tasks).toHaveBeenCalledWith({ id: 'task-1' });
    expect(mocks.cancel).toHaveBeenCalled();
    expect(message.success).toHaveBeenCalledWith('取消请求已提交，任务将在下一个检查点停止');
  });

  it('handleCancelTask should show error on failure', async () => {
    mocks.list.mockResolvedValue(successResponse([]));
    mocks.cancel.mockResolvedValue(failureResponse('终止任务失败'));

    const { result } = renderHook(() => useFactorTasks());

    await act(async () => {
      await result.current.handleCancelTask('task-1');
    });

    expect(message.error).toHaveBeenCalledWith('终止任务失败');
  });
});
