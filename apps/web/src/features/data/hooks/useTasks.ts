import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { api } from '../../../api/api';
import { isActiveTaskStatus, Task } from '../types';

const POLL_INTERVAL_MS = 5000;

function getApiError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value) {
    return String(value.error);
  }
  return fallback;
}

export const useTasks = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const requestGeneration = useRef(0);

  const fetchTasks = useCallback(async (showLoading = false) => {
    const generation = ++requestGeneration.current;
    if (showLoading) setLoading(true);
    try {
      const { data, error: apiError } = await api.tasks['data-collection'].get({
        query: { limit: pageSize, offset: (page - 1) * pageSize },
      });
      if (generation !== requestGeneration.current) return;
      if (apiError || !data || !('items' in data)) {
        setError('获取数据采集任务失败');
        return;
      }
      setTasks(data.items);
      setTotal(data.total);
      setActiveTask(
        data.activeTask ?? data.items.find((task) => isActiveTaskStatus(task.status)) ?? null,
      );
      setError(null);
    } catch {
      if (generation === requestGeneration.current) {
        setError('网络异常，暂时无法获取任务状态');
      }
    } finally {
      if (showLoading && generation === requestGeneration.current) setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (showLoading = false) => {
      await fetchTasks(showLoading);
      if (!cancelled) timer = setTimeout(() => poll(false), POLL_INTERVAL_MS);
    };

    void poll(true);
    return () => {
      cancelled = true;
      requestGeneration.current += 1;
      if (timer) clearTimeout(timer);
    };
  }, [fetchTasks]);

  const handleRunNow = useCallback(async () => {
    if (running || activeTask) return;
    setRunning(true);
    try {
      const { data, error: apiError } = await api.tasks['data-collection'].run.post();
      if (apiError || !data || !data.success) {
        message.warning(getApiError(apiError?.value ?? data, '已有任务正在执行或触发失败'));
        await fetchTasks();
        return;
      }
      message.success('数据采集任务已创建');
      await fetchTasks();
    } catch {
      message.error('触发失败，请检查网络后重试');
    } finally {
      setRunning(false);
    }
  }, [activeTask, fetchTasks, running]);

  const handleCancelTask = useCallback(async (id: string) => {
    if (cancellingId) return;
    setCancellingId(id);
    try {
      const { data, error: apiError } = await api.tasks({ id }).cancel.post();
      if (apiError || !data || !data.success) {
        message.error(getApiError(apiError?.value ?? data, '取消任务失败'));
        return;
      }
      message.success(
        data.status === 'CANCELLED' ? '待执行任务已取消' : '取消请求已提交',
      );
      await fetchTasks();
    } catch {
      message.error('取消失败，请检查网络后重试');
    } finally {
      setCancellingId(null);
    }
  }, [cancellingId, fetchTasks]);

  const changePage = useCallback((nextPage: number, nextPageSize: number) => {
    setPage(nextPageSize === pageSize ? nextPage : 1);
    setPageSize(nextPageSize);
  }, [pageSize]);

  return {
    tasks,
    total,
    page,
    pageSize,
    loading,
    running,
    cancellingId,
    error,
    activeTask,
    fetchTasks,
    changePage,
    handleRunNow,
    handleCancelTask,
  };
};
