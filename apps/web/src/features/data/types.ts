import type { api } from '../../api/api';
import type { ApiData } from '../../api/request';

type DataCollectionResponse = ApiData<typeof api.tasks['data-collection']['get']>;

export type Task = DataCollectionResponse['items'][number];

export const ACTIVE_TASK_STATUSES = ['PENDING', 'RUNNING', 'CANCELLING'] as const;
export const TERMINAL_TASK_STATUSES = [
  'COMPLETED',
  'PARTIAL_SUCCESS',
  'FAILED',
  'CANCELLED',
] as const;

export function isActiveTaskStatus(status: string): boolean {
  return ACTIVE_TASK_STATUSES.includes(status as (typeof ACTIVE_TASK_STATUSES)[number]);
}

export function isTerminalTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.includes(status as (typeof TERMINAL_TASK_STATUSES)[number]);
}

export interface WorkerState {
  workerId: number;
  total: number;
  success: number;
  failed: number;
  currentCode: string | null;
  status: 'idle' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
}

type TaskCall = ReturnType<typeof api.tasks>;
export type FailedStocksResponse = ApiData<TaskCall['failed-stocks']['get']>;
export type FailedStock = FailedStocksResponse['failures'][number];
