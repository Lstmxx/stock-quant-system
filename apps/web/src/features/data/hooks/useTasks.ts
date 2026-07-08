import { useState, useEffect } from 'react';
import { message } from 'antd';
import { api } from '../../../api/api';
import { Task } from '../types';

export const useTasks = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const { data, error } = await api.tasks.get();
      if (data) {
        const dataTasks = (data as Task[])
          .filter((t) => t.type === 'DATA_COLLECTION')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setTasks(dataTasks);

        const active = dataTasks.find((t) => t.status === 'PENDING' || t.status === 'RUNNING');
        if (active && active.id !== activeTaskId) {
          setActiveTaskId(active.id);
        } else if (!active && activeTaskId) {
          setActiveTaskId(null);
        }
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
  }, [activeTaskId]);

  const handleRunNow = async () => {
    try {
      const { error } = await api.tasks['data-collection'].run.post();
      if (!error) {
        message.success('已触发更新');
        fetchTasks();
      } else {
        message.error('触发失败');
      }
    } catch (e) {
      // errors handled by interceptor
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

  return { tasks, loading, activeTaskId, setActiveTaskId, fetchTasks, handleRunNow, handleCancelTask };
};
