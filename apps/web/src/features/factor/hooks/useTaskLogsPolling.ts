import { useEffect, useRef, useState } from 'react';

import { api } from '../../../api/api';

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function useTaskLogsPolling(
  taskId: string | null,
  taskStatus?: string,
  pollInterval = POLL_INTERVAL_MS,
) {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const generationRef = useRef(0);
  const statusRef = useRef(taskStatus);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    statusRef.current = taskStatus;
  }, [taskStatus]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setLogs([]);
    setError(null);
    offsetRef.current = 0;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!taskId) return;

    let disposed = false;
    const poll = async () => {
      try {
        const response = await api.tasks({ id: taskId }).logs.get({
          query: { offset: offsetRef.current },
        });
        if (disposed || generationRef.current !== generation) return;
        if (response.error || !response.data || typeof response.data === 'string') {
          setError('任务日志加载失败，请稍后重试');
        } else {
          setError(null);
          const newLogs = response.data.logs.map(formatLogLine);
          if (newLogs.length > 0) setLogs((previous) => [...previous, ...newLogs]);
          offsetRef.current = response.data.nextOffset;
        }
      } catch {
        if (!disposed && generationRef.current === generation) {
          setError('任务日志加载失败，请检查网络连接');
        }
      } finally {
        if (
          !disposed
          && generationRef.current === generation
          && !TERMINAL_STATUSES.has(statusRef.current ?? '')
        ) {
          timeoutRef.current = setTimeout(() => void poll(), pollInterval);
        }
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [taskId, pollInterval]);

  return { logs, error };
}

function formatLogLine(log: string): string {
  try {
    const parsed = JSON.parse(log) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : log;
  } catch {
    return log;
  }
}
