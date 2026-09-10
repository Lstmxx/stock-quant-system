import {
	alphaTasks,
	dataCollectionConfigs,
	db,
	llmModels,
	userConfigs,
} from "@stock-quant/database";
import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import Redis from "ioredis";
import { redisUrl } from "../../lib/env";
import type { CreateMiningTaskBody } from "./model";

const QUEUE_NAME = "stock:tasks:queue";
const GLOBAL_CONFIG_SCOPE = "GLOBAL";
const ACTIVE_DATA_COLLECTION_STATUSES = [
	"PENDING",
	"RUNNING",
	"CANCELLING",
] as const;
const RETRYABLE_DATA_COLLECTION_STATUSES = [
	"COMPLETED",
	"PARTIAL_SUCCESS",
	"FAILED",
	"CANCELLED",
] as const;

export const DEFAULT_DATA_COLLECTION_CONFIG = {
	lookbackDays: 250,
	workerCount: 4,
	cronExpression: "0 20 * * mon-fri",
} as const;

type DataCollectionParams = {
	days: number;
	force: boolean;
	workerCount: number;
	trigger: "MANUAL" | "SCHEDULED" | "RETRY";
	stocks?: string[];
	retryOf?: string;
};

export function getRedis() {
	const client = new Redis(redisUrl);
	client.on("error", () => {
		// Callers surface operation failures through their own result/error contract.
	});
	return client;
}

export function isUniqueViolation(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as { code?: string; cause?: { code?: string } };
	return candidate.code === "23505" || candidate.cause?.code === "23505";
}

export abstract class TaskService {
	static async failInterruptedAnalysisTasks(): Promise<number> {
		const rows = await db
			.update(alphaTasks)
			.set({
				status: "FAILED",
				result: { error: "API 服务重启，分析任务已中断，请重新发起" },
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(alphaTasks.type, "LLM_ANALYSIS"),
					inArray(alphaTasks.status, ["PENDING", "RUNNING"]),
				),
			)
			.returning({ id: alphaTasks.id });
		return rows.length;
	}

	static async enqueueTask(
		taskId: string,
		payload: Record<string, unknown>,
	): Promise<boolean> {
		const redis = getRedis();
		try {
			await redis.rpush(QUEUE_NAME, JSON.stringify(payload));
			return true;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			await db
				.update(alphaTasks)
				.set({
					status: "FAILED",
					result: { error: "任务入队失败", detail },
					updatedAt: new Date(),
				})
				.where(eq(alphaTasks.id, taskId));
			return false;
		} finally {
			await redis.quit().catch(() => undefined);
		}
	}

	static async listByUser(userId: string) {
		return await db
			.select()
			.from(alphaTasks)
			.where(eq(alphaTasks.userId, userId))
			.orderBy(alphaTasks.createdAt);
	}

	static async listDataCollectionTasks(limit: number, offset: number) {
		const where = eq(alphaTasks.type, "DATA_COLLECTION");
		const [items, totalRows, activeTask] = await Promise.all([
			db
				.select()
				.from(alphaTasks)
				.where(where)
				.orderBy(desc(alphaTasks.createdAt))
				.limit(limit)
				.offset(offset),
			db.select({ value: count() }).from(alphaTasks).where(where),
			this.findActiveDataCollectionTask(),
		]);
		return {
			items,
			total: totalRows[0]?.value ?? 0,
			limit,
			offset,
			activeTask,
		};
	}

	static async createMiningTask(
		userId: string,
		params: CreateMiningTaskBody,
	) {
		const configRows = await db
			.select()
			.from(userConfigs)
			.where(
				and(
					eq(userConfigs.userId, userId),
					eq(userConfigs.key, "FACTOR_TASK_LLM_MODEL"),
				),
			);

		if (configRows.length === 0) {
			return {
				success: false as const,
				code: "TASK_MODEL_REQUIRED" as const,
				error: "未选择因子任务的大模型配置，请先在任务配置中选择模型",
			};
		}

		const llmModelId = configRows[0].value;
		const modelRows = await db
			.select()
			.from(llmModels)
			.where(
				and(eq(llmModels.id, llmModelId), eq(llmModels.userId, userId)),
			);
		if (modelRows.length === 0) {
			return {
				success: false as const,
				code: "TASK_MODEL_NOT_FOUND" as const,
				error: "所选大模型已不存在，请重新配置",
			};
		}

		const taskParams = { ...params, llmModelId };
		const [task] = await db
			.insert(alphaTasks)
			.values({
				userId,
				type: "FACTOR_MINING",
				status: "PENDING",
				params: taskParams,
			})
			.returning();

		const enqueued = await this.enqueueTask(task.id, {
			taskId: task.id,
			userId,
			type: "FACTOR_MINING",
			params: taskParams,
		});
		if (!enqueued) {
			return {
				success: false as const,
				code: "QUEUE_UNAVAILABLE" as const,
				error: "任务入队失败，请稍后重试",
				taskId: task.id,
			};
		}

		return { success: true as const, taskId: task.id };
	}

	static async getDataCollectionConfig() {
		const [config] = await db
			.select()
			.from(dataCollectionConfigs)
			.where(eq(dataCollectionConfigs.scope, GLOBAL_CONFIG_SCOPE));

		if (!config) return { ...DEFAULT_DATA_COLLECTION_CONFIG };
		return {
			lookbackDays: config.lookbackDays,
			workerCount: config.workerCount,
			cronExpression: config.cronExpression,
		};
	}

	static async setDataCollectionConfig(
		updatedBy: string,
		lookbackDays: number,
		workerCount: number,
		cronExpression: string,
	) {
		await db
			.insert(dataCollectionConfigs)
			.values({
				scope: GLOBAL_CONFIG_SCOPE,
				updatedBy,
				lookbackDays,
				workerCount,
				cronExpression,
			})
			.onConflictDoUpdate({
				target: dataCollectionConfigs.scope,
				set: {
					updatedBy,
					lookbackDays,
					workerCount,
					cronExpression,
					updatedAt: new Date(),
				},
			});
		return { success: true };
	}

	static async findActiveDataCollectionTask() {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(
				and(
					eq(alphaTasks.type, "DATA_COLLECTION"),
					inArray(alphaTasks.status, [...ACTIVE_DATA_COLLECTION_STATUSES]),
				),
			);
		return task ?? null;
	}

	private static async createDataCollectionTask(
		userId: string | null,
		params: DataCollectionParams,
	) {
		const active = await this.findActiveDataCollectionTask();
		if (active) {
			return {
				success: false as const,
				code: "ACTIVE_TASK" as const,
				conflict: true as const,
				error: "已有数据采集任务正在执行",
				taskId: active.id,
				status: active.status,
			};
		}

		let task: typeof alphaTasks.$inferSelect;
		try {
			[task] = await db
				.insert(alphaTasks)
				.values({
					userId,
					type: "DATA_COLLECTION",
					status: "PENDING",
					params,
				})
				.returning();
		} catch (error) {
			if (isUniqueViolation(error)) {
				const current = await this.findActiveDataCollectionTask();
				return {
					success: false as const,
					code: "ACTIVE_TASK" as const,
					conflict: true as const,
					error: "已有数据采集任务正在执行",
					taskId: current?.id,
					status: current?.status,
				};
			}
			throw error;
		}

		const enqueued = await this.enqueueTask(task.id, {
			taskId: task.id,
			userId,
			type: "DATA_COLLECTION",
			params,
		});
		if (!enqueued) {
			return {
				success: false as const,
				code: "QUEUE_UNAVAILABLE" as const,
				conflict: false as const,
				error: "任务入队失败，请稍后重试",
				taskId: task.id,
			};
		}

		return { success: true as const, taskId: task.id };
	}

	static async runDataCollectionTask(userId: string) {
		const config = await this.getDataCollectionConfig();
		return this.createDataCollectionTask(userId, {
			days: config.lookbackDays,
			force: true,
			workerCount: config.workerCount,
			trigger: "MANUAL",
		});
	}

	static async getTaskStatus(userId: string, taskId: string) {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(
				and(
					eq(alphaTasks.id, taskId),
					or(
						eq(alphaTasks.userId, userId),
						eq(alphaTasks.type, "DATA_COLLECTION"),
					),
				),
			);
		return task ?? null;
	}

	static async cancelTask(userId: string, taskId: string) {
		const task = await this.getTaskStatus(userId, taskId);
		if (!task) return { success: false as const, code: "TASK_NOT_FOUND" as const, error: "任务不存在或无权访问" };

		if (task.status === "PENDING" || task.status === "RUNNING") {
			const redis = getRedis();
			try {
				await redis.setex(`task_cancelled:${task.id}`, 3600, "1");
				const nextStatus =
					task.status === "PENDING" ? "CANCELLED" : "CANCELLING";
				await db
					.update(alphaTasks)
					.set({ status: nextStatus, updatedAt: new Date() })
					.where(eq(alphaTasks.id, task.id));
				return { success: true as const, status: nextStatus };
			} finally {
				await redis.quit().catch(() => undefined);
			}
		}

		return { success: true as const, status: task.status };
	}

	static async getFailedStocks(userId: string, taskId: string) {
		const task = await this.getTaskStatus(userId, taskId);
		if (!task || task.type !== "DATA_COLLECTION") return null;

		const redis = getRedis();
		try {
			const [stocks, reasons] = await Promise.all([
				redis.smembers(`task_failed_stocks:${taskId}`),
				redis.hgetall(`task_failed_stock_errors:${taskId}`),
			]);
			return {
				taskId,
				stocks,
				failures: stocks.map((code) => ({
					code,
					reason: reasons[code] || "未知错误",
				})),
			};
		} finally {
			await redis.quit().catch(() => undefined);
		}
	}

	static async retryFailedStocks(userId: string, taskId: string) {
		const task = await this.getTaskStatus(userId, taskId);
		if (
			!task ||
			task.type !== "DATA_COLLECTION" ||
			!RETRYABLE_DATA_COLLECTION_STATUSES.includes(
				task.status as (typeof RETRYABLE_DATA_COLLECTION_STATUSES)[number],
			)
		) {
			return { success: false as const, code: "TASK_NOT_RETRYABLE" as const, error: "任务不可重试" };
		}

		const failed = await this.getFailedStocks(userId, taskId);
		if (!failed || failed.stocks.length === 0) {
			return { success: false as const, code: "NO_FAILED_STOCKS" as const, error: "没有可重试的失败股票" };
		}

		const config = await this.getDataCollectionConfig();
		const result = await this.createDataCollectionTask(userId, {
			stocks: failed.stocks,
			days: config.lookbackDays,
			force: true,
			retryOf: taskId,
			workerCount: config.workerCount,
			trigger: "RETRY",
		});
		return result.success
			? { ...result, stockCount: failed.stocks.length }
			: result;
	}

	static async getTaskLogs(userId: string, taskId: string, offset: number) {
		const task = await this.getTaskStatus(userId, taskId);
		if (!task) return null;

		const redis = getRedis();
		try {
			const logs = await redis.lrange(`task_log_list:${taskId}`, offset, -1);
			return { logs, nextOffset: offset + logs.length };
		} finally {
			await redis.quit().catch(() => undefined);
		}
	}
}
