import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';

import { api } from '../../../api/api';
import type { FactorSelectionTask } from '../types';

interface CreateSelectionInput {
  universeType: 'ALL_MARKET' | 'WATCHLIST';
  topN: number;
  lookbackDays: number;
}

export function useFactorSelections() {
  const [tasks, setTasks] = useState<FactorSelectionTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await api['factor-selections'].get({
        query: { limit: pageSize, offset: (current - 1) * pageSize },
      });
      if (data) {
        setTasks(data.data);
        setTotal(data.total);
      } else if (error) {
        message.error('获取选股任务失败');
      }
    } finally {
      setLoading(false);
    }
  }, [current, pageSize]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await fetchTasks();
      if (active) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [fetchTasks]);

  const createTask = useCallback(async (input: CreateSelectionInput) => {
    const { data, error } = await api['factor-selections'].post(input);
    if (error || !data?.success) {
      const value = error?.value;
      const detail = value && typeof value === 'object' && 'error' in value
        ? String(value.error)
        : '创建选股任务失败';
      message.error(detail);
      return false;
    }
    message.success('选股任务已创建');
    await fetchTasks();
    return true;
  }, [fetchTasks]);

  return {
    tasks,
    total,
    loading,
    current,
    pageSize,
    setCurrent,
    setPageSize,
    createTask,
    fetchTasks,
  };
}
