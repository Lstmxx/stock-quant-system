import { createHash } from "node:crypto";

import {
	alphaTasks,
	db,
	llmModels,
	llmStockSelectionAttempts,
	llmStockSelectionResults,
	watchlists,
} from "@stock-quant/database";
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	or,
} from "drizzle-orm";

import { resolveFactorSet } from "../factor-selection/service";
import { isUniqueViolation, TaskService } from "../task/service";
import {
	decodeLlmStockSelectionParams,
	decodeLlmStockSelectionSummary,
	LLM_SELECTION_DEFAULTS,
	type CreateLlmStockSelectionBody,
	type LlmStockSelectionResultView,
	type LlmStockSelectionTaskParams,
} from "./model";

const ACTIVE_STATUSES = ["PENDING", "RUNNING", "CANCELLING"] as const;
const RETRYABLE_STATUSES = ["COMPLETED", "PARTIAL_SUCCESS", "FAILED"] as const;

export class LlmStockSelectionServiceError extends Error {
	readonly code:
		| "ACTIVE_TASK"
		| "MODEL_NOT_FOUND"
		| "FACTOR_SET_EMPTY"
		| "TASK_NOT_FOUND"
		| "TASK_NOT_RETRYABLE"
		| "NO_FAILED_CANDIDATES"
		| "INVALID_RETRY_SYMBOLS"
		| "QUEUE_UNAVAILABLE";
	readonly status: 400 | 404 | 409 | 503;
	readonly taskId?: string;

	constructor(
		code:
			| "ACTIVE_TASK"
			| "MODEL_NOT_FOUND"
			| "FACTOR_SET_EMPTY"
			| "TASK_NOT_FOUND"
			| "TASK_NOT_RETRYABLE"
			| "NO_FAILED_CANDIDATES"
			| "INVALID_RETRY_SYMBOLS"
			| "QUEUE_UNAVAILABLE",
		message: string,
		status: 400 | 404 | 409 | 503,
		taskId?: string,
	) {
		super(message);
		this.name = "LlmStockSelectionServiceError";
		this.code = code;
		this.status = status;
		this.taskId = taskId;
	}
}

function toTaskView(task: typeof alphaTasks.$inferSelect) {
	return {
		...task,
		params: decodeLlmStockSelectionParams(task.params),
		result: decodeLlmStockSelectionSummary(task.result),
	};
}

export abstract class LlmStockSelectionService {
	static async findActive(userId: string) {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(
				and(
					eq(alphaTasks.userId, userId),
					eq(alphaTasks.type, "LLM_STOCK_SELECTION"),
					inArray(alphaTasks.status, [...ACTIVE_STATUSES]),
				),
			)
			.limit(1);
		return task ? toTaskView(task) : null;
	}

	static async create(userId: string, body: CreateLlmStockSelectionBody) {
		const [model] = await db
			.select({
				id: llmModels.id,
				provider: llmModels.provider,
				modelName: llmModels.modelName,
				name: llmModels.name,
			})
			.from(llmModels)
			.where(and(eq(llmModels.id, body.llmModelId), eq(llmModels.userId, userId)))
			.limit(1);
		if (!model) {
			throw new LlmStockSelectionServiceError(
				"MODEL_NOT_FOUND",
				"大模型配置不存在或无权访问",
				404,
			);
		}

		const { mode, factors } = await resolveFactorSet(userId);
		if (factors.length === 0) {
			throw new LlmStockSelectionServiceError(
				"FACTOR_SET_EMPTY",
				"暂无有效因子，请先完成因子挖掘",
				400,
			);
		}
		const factorIds = [...new Set(factors.map((factor) => factor.id))].sort();
		const factorSetHash = createHash("sha256")
			.update(factorIds.join(","))
			.digest("hex");
		const watchlistRows = await db
			.select({ symbol: watchlists.symbol })
			.from(watchlists)
			.where(eq(watchlists.userId, userId));
		const watchlistSymbols = [
			...new Set(watchlistRows.map((row) => row.symbol)),
		].sort();

		const active = await this.findActive(userId);
		if (active) {
			throw new LlmStockSelectionServiceError(
				"ACTIVE_TASK",
				"已有 LLM 选股任务正在执行",
				409,
				active.id,
			);
		}

		const params: LlmStockSelectionTaskParams = {
			llmModelId: body.llmModelId,
			llmProvider: model.provider,
			llmModelName: model.modelName,
			llmModelDisplayName: model.name,
			candidateCount: body.candidateCount,
			finalTopN: body.finalTopN,
			lookbackDays: body.lookbackDays,
			factorIds,
			factorSetHash,
			selectionMode: mode,
			watchlistSymbols,
			universeType: "MAIN_BOARD",
			indicatorProfileVersion: LLM_SELECTION_DEFAULTS.indicatorProfileVersion,
			inputSchemaVersion: LLM_SELECTION_DEFAULTS.inputSchemaVersion,
			outputSchemaVersion: LLM_SELECTION_DEFAULTS.outputSchemaVersion,
			horizonTradingDays: LLM_SELECTION_DEFAULTS.horizonTradingDays,
			maxCandidates: LLM_SELECTION_DEFAULTS.maxCandidates,
		};

		let task: typeof alphaTasks.$inferSelect;
		try {
			[task] = await db
				.insert(alphaTasks)
				.values({
					userId,
					type: "LLM_STOCK_SELECTION",
					status: "PENDING",
					params,
				})
				.returning();
		} catch (error) {
			if (isUniqueViolation(error)) {
				const current = await this.findActive(userId);
				throw new LlmStockSelectionServiceError(
					"ACTIVE_TASK",
					"已有 LLM 选股任务正在执行",
					409,
					current?.id,
				);
			}
			throw error;
		}

		const enqueued = await TaskService.enqueueTask(task.id, {
			taskId: task.id,
			userId,
			type: "LLM_STOCK_SELECTION",
			params,
		});
		if (!enqueued) {
			throw new LlmStockSelectionServiceError(
				"QUEUE_UNAVAILABLE",
				"任务入队失败，请稍后重试",
				503,
				task.id,
			);
		}
		return { taskId: task.id };
	}

	static async list(userId: string, limit = 20, offset = 0) {
		const condition = and(
			eq(alphaTasks.userId, userId),
			eq(alphaTasks.type, "LLM_STOCK_SELECTION"),
		);
		const [rows, totalRows, activeTask] = await Promise.all([
			db
				.select()
				.from(alphaTasks)
				.where(condition)
				.orderBy(desc(alphaTasks.createdAt))
				.limit(limit)
				.offset(offset),
			db.select({ value: count() }).from(alphaTasks).where(condition),
			this.findActive(userId),
		]);
		return {
			items: rows.map(toTaskView),
			total: totalRows[0]?.value ?? 0,
			limit,
			offset,
			activeTask,
		};
	}

	static async getTask(userId: string, taskId: string) {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(
				and(
					eq(alphaTasks.id, taskId),
					eq(alphaTasks.userId, userId),
					eq(alphaTasks.type, "LLM_STOCK_SELECTION"),
				),
			)
			.limit(1);
		return task ?? null;
	}

	static async detail(userId: string, taskId: string) {
		const task = await this.getTask(userId, taskId);
		return task ? toTaskView(task) : null;
	}

	static async results(
		userId: string,
		taskId: string,
		view: LlmStockSelectionResultView,
		limit: number,
		offset: number,
	) {
		const task = await this.getTask(userId, taskId);
		if (!task) return null;
		const viewCondition =
			view === "selected"
				? eq(llmStockSelectionResults.selected, true)
				: view === "failed"
					? or(
							eq(llmStockSelectionResults.universeStatus, "EXCLUDED"),
							eq(llmStockSelectionResults.llmStatus, "FAILED"),
						)
					: eq(llmStockSelectionResults.isLlmCandidate, true);
		const condition = and(
			eq(llmStockSelectionResults.taskId, taskId),
			eq(llmStockSelectionResults.userId, userId),
			viewCondition,
		);
		const [items, totalRows] = await Promise.all([
			db
				.select()
				.from(llmStockSelectionResults)
				.where(condition)
				.orderBy(
					asc(llmStockSelectionResults.finalRank),
					asc(llmStockSelectionResults.quantitativeRank),
					asc(llmStockSelectionResults.symbol),
				)
				.limit(limit)
				.offset(offset),
			db
				.select({ value: count() })
				.from(llmStockSelectionResults)
				.where(condition),
		]);
		return { task: toTaskView(task), items, total: totalRows[0]?.value ?? 0 };
	}

	static async stockDetail(userId: string, taskId: string, symbol: string) {
		const [result] = await db
			.select()
			.from(llmStockSelectionResults)
			.where(
				and(
					eq(llmStockSelectionResults.taskId, taskId),
					eq(llmStockSelectionResults.userId, userId),
					eq(llmStockSelectionResults.symbol, symbol),
				),
			)
			.limit(1);
		if (!result) return null;
		const attempts = await db
			.select()
			.from(llmStockSelectionAttempts)
			.where(
				and(
					eq(llmStockSelectionAttempts.resultId, result.id),
					eq(llmStockSelectionAttempts.userId, userId),
				),
			)
			.orderBy(asc(llmStockSelectionAttempts.attemptNo));
		return { result, attempts };
	}

	static async cancel(userId: string, taskId: string) {
		const task = await this.getTask(userId, taskId);
		if (!task) return null;
		return TaskService.cancelTask(userId, taskId);
	}

	static async retryFailed(
		userId: string,
		taskId: string,
		requestedSymbols?: string[],
	) {
		const task = await this.getTask(userId, taskId);
		if (!task) {
			throw new LlmStockSelectionServiceError(
				"TASK_NOT_FOUND",
				"任务不存在或无权访问",
				404,
			);
		}
		if (
			!RETRYABLE_STATUSES.includes(
				task.status as (typeof RETRYABLE_STATUSES)[number],
			)
		) {
			throw new LlmStockSelectionServiceError(
				"TASK_NOT_RETRYABLE",
				"当前任务状态不可重试",
				409,
			);
		}
		const params = decodeLlmStockSelectionParams(task.params);
		if (!params) {
			throw new LlmStockSelectionServiceError(
				"TASK_NOT_RETRYABLE",
				"任务配置快照无效",
				409,
			);
		}
		const [model] = await db
			.select({ id: llmModels.id })
			.from(llmModels)
			.where(and(eq(llmModels.id, params.llmModelId), eq(llmModels.userId, userId)))
			.limit(1);
		if (!model) {
			throw new LlmStockSelectionServiceError(
				"MODEL_NOT_FOUND",
				"原任务使用的大模型已删除，请重新发起任务",
				404,
			);
		}
		const failedRows = await db
			.select({ symbol: llmStockSelectionResults.symbol })
			.from(llmStockSelectionResults)
			.where(
				and(
					eq(llmStockSelectionResults.taskId, taskId),
					eq(llmStockSelectionResults.userId, userId),
					eq(llmStockSelectionResults.llmStatus, "FAILED"),
				),
			);
		const failedSymbols = new Set(failedRows.map((row) => row.symbol));
		if (failedSymbols.size === 0) {
			throw new LlmStockSelectionServiceError(
				"NO_FAILED_CANDIDATES",
				"没有可重试的失败候选",
				400,
			);
		}
		const retrySymbols = requestedSymbols
			? [...new Set(requestedSymbols)].sort()
			: [...failedSymbols].sort();
		if (retrySymbols.some((symbol) => !failedSymbols.has(symbol))) {
			throw new LlmStockSelectionServiceError(
				"INVALID_RETRY_SYMBOLS",
				"只能重试该任务中失败的候选股票",
				400,
			);
		}
		const active = await this.findActive(userId);
		if (active && active.id !== taskId) {
			throw new LlmStockSelectionServiceError(
				"ACTIVE_TASK",
				"已有其他 LLM 选股任务正在执行",
				409,
				active.id,
			);
		}

		const retryParams = { ...params, retrySymbols };
		try {
			await db
				.update(alphaTasks)
				.set({ status: "PENDING", params: retryParams, updatedAt: new Date() })
				.where(and(eq(alphaTasks.id, taskId), eq(alphaTasks.userId, userId)));
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new LlmStockSelectionServiceError(
					"ACTIVE_TASK",
					"已有其他 LLM 选股任务正在执行",
					409,
				);
			}
			throw error;
		}
		const enqueued = await TaskService.enqueueTask(taskId, {
			taskId,
			userId,
			type: "LLM_STOCK_SELECTION",
			params: retryParams,
		});
		if (!enqueued) {
			throw new LlmStockSelectionServiceError(
				"QUEUE_UNAVAILABLE",
				"重试任务入队失败，请稍后重试",
				503,
				taskId,
			);
		}
		return { taskId, retryCount: retrySymbols.length };
	}
}
