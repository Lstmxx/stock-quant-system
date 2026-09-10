import type { api } from '../../api/api';
import type { ApiData } from '../../api/request';

type SelectionCall = ReturnType<typeof api['llm-stock-selections']>;
type TaskPayload = ApiData<typeof api['llm-stock-selections']['get']>['items'][number];
type ResultsPayload = ApiData<SelectionCall['results']['get']>;
type StockDetailCall = ReturnType<SelectionCall['results']>;

export type LlmSelectionStatus = (typeof selectionStatuses)[number];
export type LlmSelectionParams = NonNullable<TaskPayload['params']>;
export type LlmSelectionSummary = TaskPayload['result'];
export type LlmSelectionTask = Omit<TaskPayload, 'status'> & {
  status: LlmSelectionStatus;
};
export type LlmSelectionResult = ResultsPayload['items'][number];
export type LlmJudgment = NonNullable<LlmSelectionResult['judgment']>;
export type LlmSelectionStockDetail = ApiData<StockDetailCall['get']>;
export type LlmSelectionAttempt = LlmSelectionStockDetail['attempts'][number];

export interface LlmSelectionListResponse {
  items: LlmSelectionTask[];
  total: number;
  activeTask: LlmSelectionTask | null;
}

export type LlmSelectionResultsResponse = Omit<ResultsPayload, 'task'> & {
  task: LlmSelectionTask;
};

export interface CreateLlmSelectionValues {
  llmModelId: string;
  candidateCount: number;
  finalTopN: number;
  lookbackDays: number;
}

const selectionStatuses = [
  'PENDING',
  'RUNNING',
  'CANCELLING',
  'CANCELLED',
  'COMPLETED',
  'PARTIAL_SUCCESS',
  'FAILED',
] as const;

function isSelectionStatus(status: string): status is LlmSelectionStatus {
  return selectionStatuses.some((knownStatus) => knownStatus === status);
}

export function normalizeLlmSelectionTask(
  task: TaskPayload,
): LlmSelectionTask {
  const status = task.status;
  if (!isSelectionStatus(status)) {
    throw new Error(`未知 LLM 选股任务状态: ${task.status}`);
  }
  return { ...task, status };
}
