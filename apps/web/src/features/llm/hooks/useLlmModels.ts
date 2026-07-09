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
        setData(resData);
      } else {
        const errorMsg = error?.value && typeof error.value === 'object' && 'message' in error.value ? String(error.value) : '获取配置失败';
        message.error(errorMsg);
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
        message.success('已删除');
        fetchData();
      } else {
        const errorMsg = error?.value && typeof error.value === 'object' && 'message' in error.value ? String(error.value.message) : '删除失败';
        message.error(errorMsg);
      }
    } catch (e) {}
  };

  const handleSetDefault = async (id: string) => {
    try {
      const { error } = await api.llm({ id }).default.post();
      if (!error) {
        message.success('已设置为默认模型');
        fetchData();
      } else {
        const errorMsg = error?.value && typeof error.value === 'object' && 'message' in error.value ? String(error.value.message) : '设置默认失败';
        message.error(errorMsg);
      }
    } catch (e) {}
  };

  return { data, loading, fetchData, handleDelete, handleSetDefault };
};
