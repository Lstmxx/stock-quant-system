import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';

import { api } from '../../../api/api';
import { getApiErrorMessage } from '../../llm/api-error';
import { normalizeLlmSelectionTask } from '../types';
import type {
  CreateLlmSelectionValues,
  LlmSelectionListResponse,
  LlmSelectionTask,
} from '../types';

const ACTIVE_STATUSES = new Set(['PENDING', 'RUNNING', 'CANCELLING']);

export function useLlmStockSelections() {
  const { message } = App.useApp();
  const messageRef = useRef(message);
  messageRef.current = message;
  const [tasks, setTasks] = useState<LlmSelectionTask[]>([]);
  const [total, setTotal] = useState(0);
  const [activeTask, setActiveTask] = useState<LlmSelectionTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rowActionId, setRowActionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const mountedRef = useRef(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await api['llm-stock-selections'].get({
        query: { limit: pageSize, offset: (page - 1) * pageSize },
      });
      if (error || !data) throw error?.value;
      const response: LlmSelectionListResponse = {
        items: data.items.map(normalizeLlmSelectionTask),
        total: data.total,
        activeTask: data.activeTask ? normalizeLlmSelectionTask(data.activeTask) : null,
      };
      if (!mountedRef.current) return false;
      setTasks(response.items);
      setTotal(response.total);
      setActiveTask(response.activeTask);
      return Boolean(response.activeTask && ACTIVE_STATUSES.has(response.activeTask.status));
    } catch (error) {
      messageRef.current.error(getApiErrorMessage(error, '加载 LLM 选股任务失败'));
      return false;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!activeTask || !ACTIVE_STATUSES.has(activeTask.status)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const shouldContinue = await fetchTasks();
      if (mountedRef.current && shouldContinue) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeTask?.id, activeTask?.status, fetchTasks]);

  const createTask = useCallback(async (values: CreateLlmSelectionValues) => {
    setSubmitting(true);
    try {
      const { data, error } = await api['llm-stock-selections'].post(values);
      if (error || !data || 'success' in data && data.success === false) {
        throw error?.value ?? data;
      }
      messageRef.current.success('LLM 选股任务已创建');
      setPage(1);
      await fetchTasks();
      return true;
    } catch (error) {
      messageRef.current.error(getApiErrorMessage(error, '创建 LLM 选股任务失败'));
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [fetchTasks]);

  const cancelTask = useCallback(async (taskId: string) => {
    if (rowActionId) return;
    setRowActionId(taskId);
    try {
      const { error } = await api['llm-stock-selections']({ id: taskId }).cancel.post();
      if (error) throw error.value;
      messageRef.current.success('取消请求已提交');
      await fetchTasks();
    } catch (error) {
      messageRef.current.error(getApiErrorMessage(error, '取消任务失败'));
    } finally {
      setRowActionId(null);
    }
  }, [fetchTasks, rowActionId]);

  const retryFailed = useCallback(async (taskId: string, symbols?: string[]) => {
    if (rowActionId) return false;
    setRowActionId(taskId);
    try {
      const { error } = await api['llm-stock-selections']({ id: taskId })['retry-failed'].post(
        symbols?.length ? { symbols } : {},
      );
      if (error) throw error.value;
      messageRef.current.success('失败项重试已提交');
      await fetchTasks();
      return true;
    } catch (error) {
      messageRef.current.error(getApiErrorMessage(error, '重试失败项失败'));
      return false;
    } finally {
      setRowActionId(null);
    }
  }, [fetchTasks, rowActionId]);

  return {
    tasks,
    total,
    activeTask,
    loading,
    submitting,
    rowActionId,
    page,
    pageSize,
    setPage,
    setPageSize,
    fetchTasks,
    createTask,
    cancelTask,
    retryFailed,
  };
}
