import { db, alphaTasks, userConfigs, dataCollectionConfigs } from "@stock-quant/database";
import { eq, and } from "drizzle-orm";
import Redis from "ioredis";

const QUEUE_NAME = "stock:tasks:queue";

export function getRedis() {
	return new Redis(process.env.REDIS_URL || "redis://localhost:6379");
}

export abstract class TaskService {
	static async listByUser(userId: string) {
		return await db
			.select()
			.from(alphaTasks)
			.where(eq(alphaTasks.userId, userId))
			.orderBy(alphaTasks.createdAt);
	}

	static async createMiningTask(
		userId: string,
		params: { targetSymbol: string; days?: number },
	) {
		const [task] = await db
			.insert(alphaTasks)
			.values({
				userId,
				type: "FACTOR_MINING",
				status: "PENDING",
				params,
			})
			.returning();

		// Push to redis queue for FastAPI engine
		const redis = getRedis();
		await redis.lpush(
			QUEUE_NAME,
			JSON.stringify({
				taskId: task.id,
				userId,
				type: "FACTOR_MINING",
				params,
			}),
		);
		await redis.quit();

		return { success: true, taskId: task.id };
	}

	static async getDataCollectionConfig(userId: string) {
		const [config] = await db
			.select()
			.from(dataCollectionConfigs)
			.where(eq(dataCollectionConfigs.userId, userId));
		
		if (config) {
			return { lookbackDays: config.lookbackDays, workerCount: config.workerCount };
		}
		return { lookbackDays: 250, workerCount: 4 };
	}

	static async setDataCollectionConfig(userId: string, lookbackDays: number, workerCount: number) {
		await db
			.insert(dataCollectionConfigs)
			.values({
				userId,
				lookbackDays,
				workerCount,
			})
			.onConflictDoUpdate({
				target: dataCollectionConfigs.userId,
				set: { lookbackDays, workerCount, updatedAt: new Date() },
			});

		return { success: true };
	}

	static async runDataCollectionTask(userId: string) {
		// Find currently running tasks
		const runningTasks = await db
			.select()
			.from(alphaTasks)
			.where(
				and(
					eq(alphaTasks.type, "DATA_COLLECTION"),
					// Or status IN ('PENDING', 'RUNNING') - assuming eq is fine, let's use OR or just filter in memory for simplicity if OR is not imported
				)
			);
		
		const activeTasks = runningTasks.filter(t => t.status === 'PENDING' || t.status === 'RUNNING');
		
		const redis = getRedis();
		
		// Cancel active tasks
		for (const task of activeTasks) {
			await redis.setex(`task_cancelled:${task.id}`, 3600, "1");
			await db
				.update(alphaTasks)
				.set({ status: "CANCELLED", updatedAt: new Date() })
				.where(eq(alphaTasks.id, task.id));
		}

		const config = await this.getDataCollectionConfig(userId);

		const [newTask] = await db
			.insert(alphaTasks)
			.values({
				userId,
				type: "DATA_COLLECTION",
				status: "PENDING",
				params: { days: config.lookbackDays, force: true, workerCount: config.workerCount },
			})
			.returning();

		await redis.lpush(
			QUEUE_NAME,
			JSON.stringify({
				taskId: newTask.id,
				userId,
				type: "DATA_COLLECTION",
				params: { days: config.lookbackDays, force: true, workerCount: config.workerCount },
			})
		);
		await redis.quit();

		return { success: true, taskId: newTask.id };
	}

	static async getTaskStatus(userId: string, taskId: string) {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(and(eq(alphaTasks.id, taskId), eq(alphaTasks.userId, userId)));
		if (!task) return null;
		return task;
	}

	static async cancelTask(userId: string, taskId: string) {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(and(eq(alphaTasks.id, taskId), eq(alphaTasks.userId, userId)));
		if (!task) return { success: false, error: "Task not found" };

		if (task.status === "PENDING" || task.status === "RUNNING") {
			const redis = getRedis();
			await redis.setex(`task_cancelled:${task.id}`, 3600, "1");
			await db
				.update(alphaTasks)
				.set({ status: "CANCELLED", updatedAt: new Date() })
				.where(eq(alphaTasks.id, task.id));
			await redis.quit();
		}
		return { success: true };
	}

	static async getFailedStocks(userId: string, taskId: string) {
		// Verify ownership first
		const task = await this.getTaskStatus(userId, taskId);
		if (!task) return null;

		const redis = getRedis();
		const stocks = await redis.smembers(`task_failed_stocks:${taskId}`);
		await redis.quit();
		return { taskId, stocks };
	}

	static async retryFailedStocks(userId: string, taskId: string) {
		const failed = await this.getFailedStocks(userId, taskId);
		if (!failed) return { success: false, error: "Task not found" };
		if (failed.stocks.length === 0) return { success: false, error: "No failed stocks to retry" };

		const redis = getRedis();
		const config = await this.getDataCollectionConfig(userId);

		const [newTask] = await db
			.insert(alphaTasks)
			.values({
				userId,
				type: "DATA_COLLECTION",
				status: "PENDING",
				params: { stocks: failed.stocks, days: config.lookbackDays, force: true, retryOf: taskId, workerCount: config.workerCount },
			})
			.returning();

		await redis.lpush(
			QUEUE_NAME,
			JSON.stringify({
				taskId: newTask.id,
				userId,
				type: "DATA_COLLECTION",
				params: { stocks: failed.stocks, days: config.lookbackDays, force: true, retryOf: taskId, workerCount: config.workerCount },
			})
		);
		await redis.quit();

		return { success: true, taskId: newTask.id, stockCount: failed.stocks.length };
	}

	static async getTaskLogs(userId: string, taskId: string, offset: number) {
		// Verify ownership
		const task = await this.getTaskStatus(userId, taskId);
		if (!task) return null;

		const redis = getRedis();
		const logs = await redis.lrange(`task_log_list:${taskId}`, offset, -1);
		await redis.quit();

		return {
			logs,
			nextOffset: offset + logs.length,
		};
	}
}

