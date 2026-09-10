import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/api';
import { getApiErrorMessage, request } from '../../../api/request';
import { isTerminalTaskStatus, WorkerState } from '../types';

const POLL_INTERVAL_MS = 2000;

export const useTaskStream = (activeTaskId: string | null) => {
  const [workers, setWorkers] = useState<Record<number, WorkerState>>({});
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    setWorkers({});
    setError(null);
    if (!activeTaskId) return () => controller.abort();

    const poll = async () => {
      try {
        const data = await request(api.tasks({ id: activeTaskId }).progress.get({
          fetch: { signal: controller.signal },
        }));
        if (stopped || generation !== generationRef.current || data.taskId !== activeTaskId) return;

        const workerMap: Record<number, WorkerState> = {};
        for (const worker of data.workers) {
          workerMap[worker.worker_id] = {
            workerId: worker.worker_id,
            total: worker.total,
            success: worker.success,
            failed: worker.failed,
            currentCode: worker.current_code,
            status: worker.status,
          };
        }
        setWorkers(workerMap);
        setError(null);
        if (isTerminalTaskStatus(data.status)) stopped = true;
      } catch (pollError) {
        if (!controller.signal.aborted && generation === generationRef.current) {
          setError(getApiErrorMessage(pollError, '进度暂时无法加载，系统将自动重试'));
        }
      }

      if (!stopped && !controller.signal.aborted) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [activeTaskId]);

  return { workers, error };
};
