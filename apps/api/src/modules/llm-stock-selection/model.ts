import { t } from "elysia";

export const LLM_SELECTION_DEFAULTS = {
	candidateCount: 50,
	finalTopN: 10,
	lookbackDays: 250,
	maxCandidates: 150,
	horizonTradingDays: 20,
	indicatorProfileVersion: "market-technical/v1",
	inputSchemaVersion: "llm-stock-selection-input/v1",
	outputSchemaVersion: "llm-stock-selection-judgment/v1",
} as const;

export const CreateLlmStockSelectionBody = t.Object({
	llmModelId: t.String({ minLength: 1 }),
	candidateCount: t.Integer({
		minimum: 20,
		maximum: 100,
		default: LLM_SELECTION_DEFAULTS.candidateCount,
	}),
	finalTopN: t.Integer({
		minimum: 1,
		maximum: 20,
		default: LLM_SELECTION_DEFAULTS.finalTopN,
	}),
	lookbackDays: t.Integer({
		minimum: 120,
		maximum: 500,
		default: LLM_SELECTION_DEFAULTS.lookbackDays,
	}),
});

export const LlmStockSelectionListQuery = t.Object({
	limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
	offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
});

export const LlmStockSelectionResultQuery = t.Object({
	view: t.Optional(
		t.Union(
			[t.Literal("selected"), t.Literal("all"), t.Literal("failed")],
			{ default: "selected" },
		),
	),
	limit: t.Optional(t.Integer({ minimum: 1, maximum: 200, default: 50 })),
	offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
});

export const RetryFailedLlmStockSelectionBody = t.Object({
	symbols: t.Optional(
		t.Array(t.String({ minLength: 1 }), {
			minItems: 1,
			maxItems: LLM_SELECTION_DEFAULTS.maxCandidates,
			uniqueItems: true,
		}),
	),
});

export type CreateLlmStockSelectionBody =
	typeof CreateLlmStockSelectionBody.static;
export type LlmStockSelectionResultView = "selected" | "all" | "failed";

export interface LlmStockSelectionTaskParams {
	llmModelId: string;
	llmProvider: string;
	llmModelName: string;
	llmModelDisplayName: string;
	candidateCount: number;
	finalTopN: number;
	lookbackDays: number;
	factorIds: string[];
	factorSetHash: string;
	selectionMode: "AUTO" | "MANUAL";
	watchlistSymbols: string[];
	universeType: "MAIN_BOARD";
	indicatorProfileVersion: typeof LLM_SELECTION_DEFAULTS.indicatorProfileVersion;
	inputSchemaVersion: typeof LLM_SELECTION_DEFAULTS.inputSchemaVersion;
	outputSchemaVersion: typeof LLM_SELECTION_DEFAULTS.outputSchemaVersion;
	horizonTradingDays: typeof LLM_SELECTION_DEFAULTS.horizonTradingDays;
	maxCandidates: typeof LLM_SELECTION_DEFAULTS.maxCandidates;
	retrySymbols?: string[];
}

export interface LlmStockSelectionRunSummary {
	dataDate?: string;
	universeCount?: number;
	eligibleCount?: number;
	excludedCount?: number;
	coverageRate?: number;
	candidateCount?: number;
	successCount?: number;
	failedCount?: number;
	finalTopN?: number;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	completedAt?: string;
	error?: string;
	message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export function decodeLlmStockSelectionParams(
	value: unknown,
): LlmStockSelectionTaskParams | null {
	if (!isRecord(value)) return null;
	if (
		typeof value.llmModelId !== "string" ||
		typeof value.candidateCount !== "number" ||
		typeof value.finalTopN !== "number" ||
		typeof value.lookbackDays !== "number" ||
		typeof value.factorSetHash !== "string"
	) {
		return null;
	}
	return {
		llmModelId: value.llmModelId,
		llmProvider:
			typeof value.llmProvider === "string" ? value.llmProvider : "unknown",
		llmModelName:
			typeof value.llmModelName === "string" ? value.llmModelName : "unknown",
		llmModelDisplayName:
			typeof value.llmModelDisplayName === "string"
				? value.llmModelDisplayName
				: "已删除模型",
		candidateCount: value.candidateCount,
		finalTopN: value.finalTopN,
		lookbackDays: value.lookbackDays,
		factorIds: stringArray(value.factorIds),
		factorSetHash: value.factorSetHash,
		selectionMode: value.selectionMode === "MANUAL" ? "MANUAL" : "AUTO",
		watchlistSymbols: stringArray(value.watchlistSymbols),
		universeType: "MAIN_BOARD",
		indicatorProfileVersion: LLM_SELECTION_DEFAULTS.indicatorProfileVersion,
		inputSchemaVersion: LLM_SELECTION_DEFAULTS.inputSchemaVersion,
		outputSchemaVersion: LLM_SELECTION_DEFAULTS.outputSchemaVersion,
		horizonTradingDays: LLM_SELECTION_DEFAULTS.horizonTradingDays,
		maxCandidates: LLM_SELECTION_DEFAULTS.maxCandidates,
		...(value.retrySymbols
			? { retrySymbols: stringArray(value.retrySymbols) }
			: {}),
	};
}

export function decodeLlmStockSelectionSummary(
	value: unknown,
): LlmStockSelectionRunSummary {
	if (!isRecord(value)) return {};
	const summary: LlmStockSelectionRunSummary = {};
	for (const key of [
		"universeCount",
		"eligibleCount",
		"excludedCount",
		"coverageRate",
		"candidateCount",
		"successCount",
		"failedCount",
		"finalTopN",
		"promptTokens",
		"completionTokens",
		"totalTokens",
	] as const) {
		if (typeof value[key] === "number") summary[key] = value[key];
	}
	for (const key of ["dataDate", "completedAt", "error", "message"] as const) {
		if (typeof value[key] === "string") summary[key] = value[key];
	}
	return summary;
}
