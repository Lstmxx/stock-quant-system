import { useState, useEffect } from 'react';
import { message } from 'antd';
import { api } from '../../../api/api';
import { LlmModel } from '../types';

export const useLlmModels = () => {
  const [data, setData] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: resData, error } = await api.llm.get();
      if (resData) {
        setData(resData as LlmModel[]);
      } else if (error) {
        message.error((error?.value as any)?.message || '获取配置失败');
      }
    } catch (e) {
      // The custom fetcher will emit api-error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const { error } = await api.llm({ id }).delete();
      if (!error) {
        message.success('删除成功');
        fetchData();
      } else {
        message.error((error?.value as any)?.message || '删除失败');
      }
    } catch (e) {}
  };

  const handleSetDefault = async (id: string) => {
    try {
      const { error } = await api.llm({ id }).default.post();
      if (!error) {
        message.success('设置默认成功');
        fetchData();
      } else {
        message.error((error?.value as any)?.message || '设置默认失败');
      }
    } catch (e) {}
  };

  return { data, loading, fetchData, handleDelete, handleSetDefault };
};
