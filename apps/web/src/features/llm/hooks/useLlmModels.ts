import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';

import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
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
      setData(await request(api.llm.get()));
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
    operation: () => Promise<unknown>,
    successMessage: string,
  ) => {
    if (activeRowsRef.current.has(id)) return false;
    activeRowsRef.current.add(id);
    setRowActions((current) => ({ ...current, [id]: action }));
    setError(null);
    try {
      await operation();
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
    () => request(api.llm({ id }).delete()),
    '已删除大模型配置',
  ), [runRowAction]);

  const handleSetDefault = useCallback((id: string) => runRowAction(
    id,
    'default',
    () => request(api.llm({ id }).default.post()),
    '已设置为默认模型',
  ), [runRowAction]);

  const handleTest = useCallback((id: string) => runRowAction(
    id,
    'test',
    () => request(api.llm({ id }).test.post()),
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
