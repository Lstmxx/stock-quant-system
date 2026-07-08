export interface Task {
  id: string;
  userId: string;
  type: string;
  status: string;
  params: any;
  result: any;
  createdAt: string | Date;
  updatedAt: string | Date;
}

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
