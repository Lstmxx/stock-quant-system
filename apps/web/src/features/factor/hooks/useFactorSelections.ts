import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';

import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
import type { FactorSelectionTask } from '../types';

interface CreateSelectionInput {
  universeType: 'ALL_MARKET' | 'WATCHLIST';
  topN: number;
  lookbackDays: number;
}

export function useFactorSelections() {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<FactorSelectionTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request(api['factor-selections'].get({
        query: { limit: pageSize, offset: (current - 1) * pageSize },
      }));
      setTasks(data.data);
      setTotal(data.total);
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取选股任务失败'));
    } finally {
      setLoading(false);
    }
  }, [current, message, pageSize]);

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
    try {
      await request(api['factor-selections'].post(input));
      message.success('选股任务已创建');
      await fetchTasks();
      return true;
    } catch (error) {
      message.error(getApiErrorMessage(error, '创建选股任务失败'));
      await fetchTasks();
      return false;
    }
  }, [fetchTasks, message]);

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
