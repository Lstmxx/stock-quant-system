import {
	boolean,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";

// --- Business Tables ---

export const watchlists = pgTable("watchlists", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
	symbol: text("symbol").notNull(), // e.g. sh.600000
	name: text("name"), // optional custom name
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().notNull()
}, (table) => [uniqueIndex("watchlists_user_symbol_unique").on(table.userId, table.symbol)]);

export const userConfigs = pgTable(
	"user_configs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		value: text("value").notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("user_configs_user_key_unique").on(table.userId, table.key),
	],
);

export const dataCollectionConfigs = pgTable(
	"data_collection_configs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		scope: text("scope").default("GLOBAL").notNull(),
		updatedBy: text("userId").references(() => user.id, { onDelete: "set null" }),
		lookbackDays: integer("lookbackDays").default(250).notNull(),
		workerCount: integer("workerCount").default(4).notNull(),
		cronExpression: text("cronExpression").default("0 20 * * mon-fri").notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("data_collection_configs_scope_unique").on(table.scope),
	],
);

export const alphaTasks = pgTable(
	"alpha_tasks",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("userId").references(() => user.id),
		status: text("status").notNull(), // PENDING, RUNNING, CANCELLING, CANCELLED, COMPLETED, PARTIAL_SUCCESS, FAILED
		type: text("type").notNull(), // "FACTOR_MINING", "DATA_COLLECTION", "LLM_ANALYSIS"
		params: jsonb("params"), // JSON params for the task
		result: jsonb("result"), // JSON results
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("alpha_tasks_active_data_collection_unique")
			.on(table.type)
			.where(
				sql`${table.type} = 'DATA_COLLECTION' AND ${table.status} IN ('PENDING', 'RUNNING', 'CANCELLING')`,
			),
		uniqueIndex("alpha_tasks_active_llm_stock_selection_user_unique")
			.on(table.userId)
			.where(
				sql`${table.type} = 'LLM_STOCK_SELECTION' AND ${table.status} IN ('PENDING', 'RUNNING', 'CANCELLING') AND ${table.userId} IS NOT NULL`,
			),
	],
);

export const alphaFactors = pgTable(
	"alpha_factors",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("userId").notNull().references(() => user.id),
		name: text("name").notNull(),
		expression: text("expression").notNull(),
		hypothesis: text("hypothesis"),
		researchDirection: text("researchDirection"),
		icValue: doublePrecision("icValue"),
		icir: doublePrecision("icir"),
		monotonicity: doublePrecision("monotonicity"),
		direction: integer("direction"),
		isValid: boolean("isValid").default(false).notNull(),
		generation: integer("generation").default(0).notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("alpha_factors_user_expression_unique").on(
			table.userId,
			table.expression,
		),
		index("alpha_factors_user_quality_idx").on(
			table.userId,
			table.isValid,
			table.icValue,
		),
	],
);

/** The user's manual override for factors shared by selection and LLM analysis. */
export const userSelectedFactors = pgTable(
	"user_selected_factors",
	{
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		factorId: uuid("factorId")
			.notNull()
			.references(() => alphaFactors.id, { onDelete: "cascade" }),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.factorId] })],
);

export interface FactorContribution {
	factorId: string;
	name: string;
	value: number;
	zScore: number;
	weight: number;
	direction: number;
	contribution: number;
	percentile: number;
}

/** Immutable per-stock output produced by a FACTOR_SELECTION task. */
export const factorSelectionResults = pgTable(
	"factor_selection_results",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		taskId: uuid("taskId")
			.notNull()
			.references(() => alphaTasks.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		symbol: text("symbol").notNull(),
		rank: integer("rank").notNull(),
		compositeScore: doublePrecision("compositeScore").notNull(),
		dataDate: text("dataDate").notNull(),
		factorContributions: jsonb("factorContributions")
			.$type<FactorContribution[]>()
			.notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("factor_selection_results_task_symbol_unique").on(
			table.taskId,
			table.symbol,
		),
		index("factor_selection_results_user_date_idx").on(
			table.userId,
			table.dataDate,
		),
		index("factor_selection_results_task_rank_idx").on(
			table.taskId,
			table.rank,
		),
	],
);

export type LlmStockSelectionUniverseStatus = "ELIGIBLE" | "EXCLUDED";
export type LlmStockSelectionCandidateSource = "QUANTITATIVE" | "WATCHLIST";
export type LlmStockSelectionStatus =
	| "NOT_REQUESTED"
	| "PENDING"
	| "SUCCEEDED"
	| "FAILED"
	| "CANCELLED";
export type LlmStockSelectionAttemptStatus = "RUNNING" | "SUCCEEDED" | "FAILED";
export type LlmStockSelectionOutlook = "BULLISH" | "NEUTRAL" | "BEARISH";
export type LlmStockSelectionSignalCategory =
	| "PRICE"
	| "VOLUME"
	| "TECHNICAL"
	| "FACTOR";

export interface LlmStockSelectionBar {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
	amount: number;
	turnover: number;
	percentageChange: number;
}

export interface LlmStockSelectionIndicatorSnapshot {
	returns: {
		oneDay: number | null;
		fiveDay: number | null;
		twentyDay: number | null;
		sixtyDay: number | null;
	};
	trend: {
		ma5: number | null;
		ma10: number | null;
		ma20: number | null;
		ma60: number | null;
		macdDif: number | null;
		macdDea: number | null;
		macdHist: number | null;
	};
	momentum: {
		rsi14: number | null;
		kdjK: number | null;
		kdjD: number | null;
		kdjJ: number | null;
		roc20: number | null;
	};
	risk: {
		atr14: number | null;
		bollingerPosition: number | null;
		bollingerBandwidth: number | null;
		volatility20: number | null;
		maxDrawdown60: number | null;
	};
	volume: {
		volumeRatio5: number | null;
		volumeRatio20: number | null;
		amountChange: number | null;
		turnover5: number | null;
		turnover20: number | null;
	};
}

export interface LlmStockSelectionInputSnapshot {
	schemaVersion: "llm-stock-selection-input/v1";
	indicatorProfileVersion: "market-technical/v1";
	horizonTradingDays: 20;
	lookbackDays: number;
	dataDate: string;
	symbol: string;
	stockName: string | null;
	candidateSources: LlmStockSelectionCandidateSource[];
	quantitativeScore: number;
	quantitativeRank: number;
	recentBars: LlmStockSelectionBar[];
	indicators: LlmStockSelectionIndicatorSnapshot;
	factorContributions: FactorContribution[];
}

export interface LlmStockSelectionJudgment {
	selectionScore: number;
	confidence: number;
	outlook: LlmStockSelectionOutlook;
	summary: string;
	strengths: string[];
	risks: string[];
	keySignals: Array<{
		category: LlmStockSelectionSignalCategory;
		name: string;
		interpretation: string;
	}>;
}

/** One auditable per-stock outcome for an LLM_STOCK_SELECTION task. */
export const llmStockSelectionResults = pgTable(
	"llm_stock_selection_results",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		taskId: uuid("taskId")
			.notNull()
			.references(() => alphaTasks.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		symbol: text("symbol").notNull(),
		stockName: text("stockName"),
		dataDate: text("dataDate").notNull(),
		universeStatus: text("universeStatus")
			.$type<LlmStockSelectionUniverseStatus>()
			.notNull(),
		exclusionStage: text("exclusionStage"),
		exclusionCode: text("exclusionCode"),
		exclusionMessage: text("exclusionMessage"),
		excludedAt: timestamp("excludedAt"),
		quantitativeScore: doublePrecision("quantitativeScore"),
		quantitativeRank: integer("quantitativeRank"),
		candidateSources: jsonb("candidateSources")
			.$type<LlmStockSelectionCandidateSource[]>()
			.default(sql`'[]'::jsonb`)
			.notNull(),
		isLlmCandidate: boolean("isLlmCandidate").default(false).notNull(),
		inputSnapshot: jsonb("inputSnapshot").$type<LlmStockSelectionInputSnapshot>(),
		llmStatus: text("llmStatus")
			.$type<LlmStockSelectionStatus>()
			.default("NOT_REQUESTED")
			.notNull(),
		judgment: jsonb("judgment").$type<LlmStockSelectionJudgment>(),
		attemptCount: integer("attemptCount").default(0).notNull(),
		latestErrorCode: text("latestErrorCode"),
		latestErrorMessage: text("latestErrorMessage"),
		latestErrorAt: timestamp("latestErrorAt"),
		selected: boolean("selected").default(false).notNull(),
		finalRank: integer("finalRank"),
		promptTokens: integer("promptTokens").default(0).notNull(),
		completionTokens: integer("completionTokens").default(0).notNull(),
		totalTokens: integer("totalTokens").default(0).notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("llm_stock_selection_results_task_symbol_unique").on(
			table.taskId,
			table.symbol,
		),
		index("llm_stock_selection_results_task_selected_rank_idx").on(
			table.taskId,
			table.selected,
			table.finalRank,
		),
		index("llm_stock_selection_results_task_status_idx").on(
			table.taskId,
			table.llmStatus,
		),
		index("llm_stock_selection_results_user_date_idx").on(
			table.userId,
			table.dataDate,
		),
	],
);

/** Immutable execution attempts for one LLM stock-selection candidate. */
export const llmStockSelectionAttempts = pgTable(
	"llm_stock_selection_attempts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resultId: uuid("resultId")
			.notNull()
			.references(() => llmStockSelectionResults.id, { onDelete: "cascade" }),
		taskId: uuid("taskId")
			.notNull()
			.references(() => alphaTasks.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		attemptNo: integer("attemptNo").notNull(),
		status: text("status").$type<LlmStockSelectionAttemptStatus>().notNull(),
		llmModelId: uuid("llmModelId"),
		provider: text("provider"),
		modelName: text("modelName"),
		modelDisplayName: text("modelDisplayName"),
		judgment: jsonb("judgment").$type<LlmStockSelectionJudgment>(),
		errorCode: text("errorCode"),
		errorMessage: text("errorMessage"),
		promptTokens: integer("promptTokens").default(0).notNull(),
		completionTokens: integer("completionTokens").default(0).notNull(),
		totalTokens: integer("totalTokens").default(0).notNull(),
		startedAt: timestamp("startedAt").defaultNow().notNull(),
		completedAt: timestamp("completedAt"),
	},
	(table) => [
		uniqueIndex("llm_stock_selection_attempts_result_attempt_unique").on(
			table.resultId,
			table.attemptNo,
		),
		index("llm_stock_selection_attempts_task_idx").on(
			table.taskId,
			table.startedAt,
		),
	],
);

export const quantStrategies = pgTable("quant_strategies", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	style: text("style").notNull(), // e.g. "Momentum", "Value"
	factors: jsonb("factors").notNull(), // Array of factor IDs or configurations
	constraints: jsonb("constraints"), // e.g. max_drawdown limit
	reportMarkdown: text("reportMarkdown"), // Final output generated by writing-beats LLM
	performance: jsonb("performance"), // Backtest summary
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().notNull()
});

export const llmModels = pgTable(
	"llm_models",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		modelName: text("modelName").notNull(),
		name: text("name").notNull(),
		baseUrl: text("baseUrl"),
		apiKey: text("apiKey"),
		isDefault: boolean("isDefault").default(false).notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("llm_models_user_default_unique")
			.on(table.userId)
			.where(sql`${table.isDefault} = true`),
		index("llm_models_user_created_idx").on(table.userId, table.createdAt),
	],
);
