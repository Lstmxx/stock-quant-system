import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFactorTasks } from '../../src/features/factor/hooks/useFactorTasks';
import { api } from '../../src/api/api';
import { message } from 'antd';

vi.mock('../../src/api/api', () => ({
  api: {
    tasks: {
      get: vi.fn(),
      mining: {
        post: vi.fn(),
      },
      // Since it's a dynamic path function `api.tasks({ id }).cancel.post()`
      // We'll mock the whole api.tasks structure accordingly below
    },
  },
}));

// Better mocking for dynamic paths
const mockCancelPost = vi.fn();
(api.tasks as any) = Object.assign(vi.fn().mockReturnValue({
  cancel: {
    post: mockCancelPost,
  },
}), api.tasks);

vi.mock('antd', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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
    (api.tasks.get as any).mockResolvedValue({ data: mockTasks });

    const { result } = renderHook(() => useFactorTasks());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should filter out DATA_COLLECTION and sort by createdAt desc
    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks[0].id).toBe('2'); // newer
    expect(result.current.tasks[1].id).toBe('3'); // older
  });

  it('should handle fetch tasks error', async () => {
    (api.tasks.get as any).mockResolvedValue({ error: { value: 'err' } });

    const { result } = renderHook(() => useFactorTasks());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(message.error).toHaveBeenCalledWith('获取任务列表失败');
    expect(result.current.tasks).toEqual([]);
  });

  it('handleCreateTask should call api and refetch on success', async () => {
    (api.tasks.get as any).mockResolvedValue({ data: [] });
    (api.tasks.mining.post as any).mockResolvedValue({ data: { id: 'new-task' } });

    const { result } = renderHook(() => useFactorTasks());

    await act(async () => {
      await result.current.handleCreateTask('动量反转', 100);
    });

    expect(api.tasks.mining.post).toHaveBeenCalledWith({ researchDirection: '动量反转', days: 100 });
    expect(message.success).toHaveBeenCalledWith('已触发挖掘任务');
    expect(api.tasks.get).toHaveBeenCalledTimes(2); // Initial mount + after create
  });

  it('handleCreateTask should show error on failure', async () => {
    (api.tasks.get as any).mockResolvedValue({ data: [] });
    (api.tasks.mining.post as any).mockResolvedValue({ error: { value: 'err' } });

    const { result } = renderHook(() => useFactorTasks());

    await act(async () => {
      await result.current.handleCreateTask('量价关系', 250);
    });

    expect(message.error).toHaveBeenCalledWith('触发失败，请重试');
  });

  it('handleCancelTask should call api and refetch on success', async () => {
    (api.tasks.get as any).mockResolvedValue({ data: [] });
    mockCancelPost.mockResolvedValue({ data: { success: true } });

    const { result } = renderHook(() => useFactorTasks());

    await act(async () => {
      await result.current.handleCancelTask('task-1');
    });

    expect(api.tasks).toHaveBeenCalledWith({ id: 'task-1' });
    expect(mockCancelPost).toHaveBeenCalled();
    expect(message.success).toHaveBeenCalledWith('取消请求已提交，任务将在下一个检查点停止');
  });

  it('handleCancelTask should show error on failure', async () => {
    (api.tasks.get as any).mockResolvedValue({ data: [] });
    mockCancelPost.mockResolvedValue({ error: { value: 'err' } });

    const { result } = renderHook(() => useFactorTasks());

    await act(async () => {
      await result.current.handleCancelTask('task-1');
    });

    expect(message.error).toHaveBeenCalledWith('终止任务失败');
  });
});
