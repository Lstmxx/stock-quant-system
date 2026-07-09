import { api } from '../../api/api';

type TaskResponse = NonNullable<Awaited<ReturnType<typeof api.tasks.get>>['data']>;
export type Task = TaskResponse[number];

export interface WorkerState {
  workerId: number;
  total: number;
  success: number;
  failed: number;
  currentCode: string | null;
  status: 'idle' | 'running' | 'completed';
}

export interface SSELog {
  code?: string;
  status?: string;
  reason?: string;
  message?: string;
  type?: string;
  worker_id?: number;
  total?: number;
  success?: number;
  failed?: number;
}

export interface FailedStocksResponse {
  taskId: string;
  stocks: string[];
}
