import { useState, useEffect } from 'react';
import { App } from 'antd';
import { api } from '../../../api/api';
import { FactorTask } from '../types';
import type { ResearchDirection } from '../components/CreateMiningTaskModal';

export const useFactorTasks = () => {
  const { message } = App.useApp();
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

  const handleCreateTask = async (researchDirection: ResearchDirection, days: number) => {
    try {
      const { error } = await api.tasks.mining.post({ researchDirection, days });
      if (!error) {
        message.success('已触发挖掘任务');
        fetchTasks();
        return true;
      } else {
        const errorMsg =
          error?.value && typeof error.value === 'object' && 'error' in error.value
            ? String(error.value.error)
            : '触发失败，请重试';
        message.error(errorMsg);
        return false;
      }
    } catch (e) {
      console.error(e);
      message.error('触发失败，请检查网络后重试');
      return false;
    }
  };

  const handleCancelTask = async (id: string) => {
    try {
      const { error } = await api.tasks({ id }).cancel.post();
      if (!error) {
        message.success('取消请求已提交，任务将在下一个检查点停止');
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
