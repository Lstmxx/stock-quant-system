import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';

import { api } from '../../../api/api';
import { getApiErrorMessage } from '../api-error';
import type { LlmModel } from '../types';

export type LlmRowAction = 'delete' | 'default' | 'test';

export function useLlmModels() {
  const { message } = App.useApp();
  const [data, setData] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowActions, setRowActions] = useState<Record<string, LlmRowAction | undefined>>({});
  const activeRowsRef = useRef(new Set<string>());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: responseData, error: responseError } = await api.llm.get();
      if (responseError || !responseData) {
        const detail = getApiErrorMessage(responseError?.value, '获取大模型配置失败');
        setError(detail);
        message.error(detail);
        return;
      }
      setData(responseData as LlmModel[]);
    } catch (requestError) {
      const detail = getApiErrorMessage(requestError, '获取大模型配置失败，请检查网络连接');
      setError(detail);
      message.error(detail);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, message]);

  const runRowAction = useCallback(async (
    id: string,
    action: LlmRowAction,
    operation: () => Promise<{ error?: { value?: unknown } | null }>,
    successMessage: string,
  ) => {
    if (activeRowsRef.current.has(id)) return false;
    activeRowsRef.current.add(id);
    setRowActions((current) => ({ ...current, [id]: action }));
    setError(null);
    try {
      const { error: responseError } = await operation();
      if (responseError) {
        const detail = getApiErrorMessage(responseError.value, `${successMessage}失败`);
        setError(detail);
        message.error(detail);
        return false;
      }
      message.success(successMessage);
      await fetchData();
      return true;
    } catch (requestError) {
      const detail = getApiErrorMessage(requestError, `${successMessage}失败，请检查网络连接`);
      setError(detail);
      message.error(detail);
      return false;
    } finally {
      activeRowsRef.current.delete(id);
      setRowActions((current) => ({ ...current, [id]: undefined }));
    }
  }, [fetchData]);

  const handleDelete = useCallback((id: string) => runRowAction(
    id,
    'delete',
    () => api.llm({ id }).delete(),
    '已删除大模型配置',
  ), [runRowAction]);

  const handleSetDefault = useCallback((id: string) => runRowAction(
    id,
    'default',
    () => api.llm({ id }).default.post(),
    '已设置为默认模型',
  ), [runRowAction]);

  const handleTest = useCallback((id: string) => runRowAction(
    id,
    'test',
    () => api.llm({ id }).test.post(),
    '连接测试成功',
  ), [runRowAction]);

  return {
    data,
    loading,
    error,
    rowActions,
    fetchData,
    handleDelete,
    handleSetDefault,
    handleTest,
  };
}
