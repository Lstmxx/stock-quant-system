import { useState, useEffect } from 'react';
import { message } from 'antd';
import { api } from '../../../api/api';
import { FactorTask } from '../types';

export const useFactorTasks = () => {
  const [tasks, setTasks] = useState<FactorTask[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const { data, error } = await api.tasks.get();
      if (data) {
        const factorTasks = data
          .filter((t) => t.type === 'FACTOR_MINING')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setTasks(factorTasks);
      } else if (error) {
        message.error('获取任务列表失败');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const timer = setInterval(fetchTasks, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleCreateTask = async (targetSymbol: string, days?: number) => {
    try {
      const { error } = await api.tasks.mining.post({ targetSymbol, days });
      if (!error) {
        message.success('已触发挖掘任务');
        fetchTasks();
      } else {
        const errorMsg =
          error?.value && typeof error.value === 'object' && 'error' in error.value
            ? String(error.value.error)
            : '触发失败，请重试';
        message.error(errorMsg);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCancelTask = async (id: string) => {
    try {
      const { error } = await api.tasks({ id }).cancel.post();
      if (!error) {
        message.success('任务已终止');
        fetchTasks();
      } else {
        message.error('终止任务失败');
      }
    } catch (e) {
      console.error(e);
    }
  };

  return { tasks, loading, fetchTasks, handleCreateTask, handleCancelTask };
};
