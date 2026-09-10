import { useState, useEffect } from 'react';
import { App } from 'antd';
import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
import { FactorTask } from '../types';
import type { ResearchDirection } from '../components/CreateMiningTaskModal';

export const useFactorTasks = () => {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<FactorTask[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await request(api.tasks.get());
      const factorTasks = data
        .filter((task) => task.type === 'FACTOR_MINING')
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
      setTasks(factorTasks);
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取任务列表失败'));
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
      await request(api.tasks.mining.post({ researchDirection, days }));
      message.success('已触发挖掘任务');
      await fetchTasks();
      return true;
    } catch (error) {
      message.error(getApiErrorMessage(error, '触发失败，请检查网络后重试'));
      await fetchTasks();
      return false;
    }
  };

  const handleCancelTask = async (id: string) => {
    try {
      await request(api.tasks({ id }).cancel.post());
      message.success('取消请求已提交，任务将在下一个检查点停止');
      await fetchTasks();
    } catch (error) {
      message.error(getApiErrorMessage(error, '终止任务失败'));
    }
  };

  return { tasks, loading, fetchTasks, handleCreateTask, handleCancelTask };
};
