import { useState, useEffect, useRef, useCallback } from 'react';
import { WorkerState } from '../types';
import { API_BASE_URL } from '../../../constant/config';

interface ProgressResponse {
  taskId: string;
  status: string;
  workers: Array<{
    worker_id: number;
    total: number;
    success: number;
    failed: number;
    current_code: string | null;
    status: 'running' | 'failed' | 'completed';
  }>;
}

const POLL_INTERVAL_MS = 2000;

export const useTaskStream = (activeTaskId: string | null) => {
  const [workers, setWorkers] = useState<Record<number, WorkerState>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchProgress = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/progress`, {
        credentials: 'include',
      });
      if (!res.ok) return;

      const data: ProgressResponse = await res.json();

      // Map engine snake_case to frontend WorkerState
      const workerMap: Record<number, WorkerState> = {};
      for (const w of data.workers) {
        const done = w.success + w.failed >= w.total && w.total > 0;
        workerMap[w.worker_id] = {
          workerId: w.worker_id,
          total: w.total,
          success: w.success,
          failed: w.failed,
          currentCode: w.current_code,
          status: done ? 'completed' : w.status === 'failed' ? 'completed' : 'running',
        };
      }
      setWorkers(workerMap);

      // Stop polling when task is fully done
      if (data.status === 'COMPLETED' || data.status === 'FAILED' || data.status === 'CANCELLED') {
        stopPolling();
      }
    } catch (err) {
      console.error('[useTaskStream] polling error:', err);
    }
  }, [stopPolling]);

  useEffect(() => {
    stopPolling();
    setWorkers({});

    if (!activeTaskId) return;

    // Fetch immediately, then every POLL_INTERVAL_MS
    fetchProgress(activeTaskId);
    intervalRef.current = setInterval(() => fetchProgress(activeTaskId), POLL_INTERVAL_MS);

    return stopPolling;
  }, [activeTaskId, fetchProgress, stopPolling]);

  return { workers };
};
