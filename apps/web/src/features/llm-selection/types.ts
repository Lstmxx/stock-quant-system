export type LlmSelectionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'PARTIAL_SUCCESS'
  | 'FAILED';

export interface LlmSelectionParams {
  llmModelId: string;
  llmProvider: string;
  llmModelName: string;
  llmModelDisplayName: string;
  candidateCount: number;
  finalTopN: number;
  lookbackDays: number;
  factorIds: string[];
  selectionMode: 'AUTO' | 'MANUAL';
  watchlistSymbols: string[];
}

export interface LlmSelectionSummary {
  dataDate?: string;
  universeCount?: number;
  eligibleCount?: number;
  excludedCount?: number;
  coverageRate?: number;
  candidateCount?: number;
  successCount?: number;
  failedCount?: number;
  finalTopN?: number;
  totalTokens?: number;
  error?: string;
  message?: string;
}

export interface LlmSelectionTask {
  id: string;
  status: LlmSelectionStatus;
  params: LlmSelectionParams | null;
  result: LlmSelectionSummary;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface LlmJudgment {
  selectionScore: number;
  confidence: number;
  outlook: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  summary: string;
  strengths: string[];
  risks: string[];
  keySignals: Array<{
    category: 'PRICE' | 'VOLUME' | 'TECHNICAL' | 'FACTOR';
    name: string;
    interpretation: string;
  }>;
}

export interface LlmSelectionResult {
  id: string;
  symbol: string;
  stockName: string | null;
  dataDate: string;
  universeStatus: 'ELIGIBLE' | 'EXCLUDED';
  exclusionStage: string | null;
  exclusionCode: string | null;
  exclusionMessage: string | null;
  quantitativeScore: number | null;
  quantitativeRank: number | null;
  candidateSources: Array<'QUANTITATIVE' | 'WATCHLIST'>;
  isLlmCandidate: boolean;
  inputSnapshot: unknown;
  llmStatus: 'NOT_REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  judgment: LlmJudgment | null;
  attemptCount: number;
  latestErrorCode: string | null;
  latestErrorMessage: string | null;
  selected: boolean;
  finalRank: number | null;
  totalTokens: number;
}

export interface LlmSelectionAttempt {
  id: string;
  attemptNo: number;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  provider: string | null;
  modelName: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  totalTokens: number;
  startedAt: string | Date;
  completedAt: string | Date | null;
}

export interface LlmSelectionListResponse {
  items: LlmSelectionTask[];
  total: number;
  activeTask: LlmSelectionTask | null;
}

export interface LlmSelectionResultsResponse {
  task: LlmSelectionTask;
  items: LlmSelectionResult[];
  total: number;
}

export interface LlmSelectionStockDetail {
  result: LlmSelectionResult;
  attempts: LlmSelectionAttempt[];
}

export interface CreateLlmSelectionValues {
  llmModelId: string;
  candidateCount: number;
  finalTopN: number;
  lookbackDays: number;
}

const selectionStatuses = new Set<LlmSelectionStatus>([
  'PENDING',
  'RUNNING',
  'CANCELLING',
  'CANCELLED',
  'COMPLETED',
  'PARTIAL_SUCCESS',
  'FAILED',
]);

export function normalizeLlmSelectionTask(
  task: Omit<LlmSelectionTask, 'status'> & { status: string },
): LlmSelectionTask {
  if (!selectionStatuses.has(task.status as LlmSelectionStatus)) {
    throw new Error(`未知 LLM 选股任务状态: ${task.status}`);
  }
  return { ...task, status: task.status as LlmSelectionStatus };
}
