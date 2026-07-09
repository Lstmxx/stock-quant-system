import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../../api/api';

const POLL_INTERVAL_MS = 2000;

export const useTaskLogsPolling = (taskId: string | null, pollInterval = 2000) => {
  const [logs, setLogs] = useState<string[]>([]);
  const offsetRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchLogs = useCallback(async (activeTaskId: string) => {
    try {
      const res = await api.tasks({ id: activeTaskId }).logs.get({
        query: { offset: offsetRef.current },
      });

      if (res.data) {
        const newLogs = res.data.logs.map((log: string) => {
          try {
            const parsed = JSON.parse(log);
            return parsed.message ?? log;
          } catch {
            return log;
          }
        });

        if (newLogs.length > 0) {
          setLogs((prev) => [...prev, ...newLogs]);
        }
        
        offsetRef.current = res.data.nextOffset;
      }
    } catch (err) {
      console.error('[useTaskLogsPolling] fetch error:', err);
    }
  }, []);

  useEffect(() => {
    stopPolling();
    setLogs([]);
    offsetRef.current = 0;

    if (!taskId) return;

    // Fetch immediately, then every POLL_INTERVAL_MS
    fetchLogs(taskId);
    intervalRef.current = setInterval(() => fetchLogs(taskId), pollInterval);

    return stopPolling;
  }, [taskId, fetchLogs, stopPolling, pollInterval]);

  return { logs };
};
