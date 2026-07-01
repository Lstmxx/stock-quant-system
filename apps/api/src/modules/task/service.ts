import { db, alphaTasks } from "@stock-quant/database";
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

	static async getTaskStatus(userId: string, taskId: string) {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(and(eq(alphaTasks.id, taskId), eq(alphaTasks.userId, userId)));
		if (!task) return null;
		return task;
	}
}
