import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
import { isActiveTaskStatus, Task } from '../types';

const POLL_INTERVAL_MS = 5000;

export const useTasks = () => {
  const { message } = App.useApp();
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
      const data = await request(api.tasks['data-collection'].get({
        query: { limit: pageSize, offset: (page - 1) * pageSize },
      }));
      if (generation !== requestGeneration.current) return;
      setTasks(data.items);
      setTotal(data.total);
      setActiveTask(
        data.activeTask ?? data.items.find((task) => isActiveTaskStatus(task.status)) ?? null,
      );
      setError(null);
    } catch (fetchError) {
      if (generation === requestGeneration.current) {
        setError(getApiErrorMessage(fetchError, '获取数据采集任务失败'));
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
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
      await request(api.tasks['data-collection'].run.post());
      message.success('数据采集任务已创建');
      await fetchTasks();
    } catch (runError) {
      message.error(getApiErrorMessage(runError, '触发失败，请检查网络后重试'));
      await fetchTasks();
    } finally {
      setRunning(false);
    }
  }, [activeTask, fetchTasks, message, running]);

  const handleCancelTask = useCallback(async (id: string) => {
    if (cancellingId) return;
    setCancellingId(id);
    try {
      const data = await request(api.tasks({ id }).cancel.post());
      message.success(
        data.status === 'CANCELLED' ? '待执行任务已取消' : '取消请求已提交',
      );
      await fetchTasks();
    } catch (cancelError) {
      message.error(getApiErrorMessage(cancelError, '取消失败，请检查网络后重试'));
    } finally {
      setCancellingId(null);
    }
  }, [cancellingId, fetchTasks, message]);

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
