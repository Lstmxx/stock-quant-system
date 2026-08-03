import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { db } from "@stock-quant/database";
import { redisUrl } from "./env";
import { logger } from "./logger";

export type DependencyHealth = {
	status: "ok" | "error";
	latencyMs?: number;
	error?: string;
};

async function checkDependency(
	check: () => Promise<void>,
): Promise<DependencyHealth> {
	const startedAt = performance.now();
	try {
		await check();
		return { status: "ok", latencyMs: Math.round(performance.now() - startedAt) };
	} catch (error) {
		logger.error({ error }, "health check dependency failed");
		return {
			status: "error",
			latencyMs: Math.round(performance.now() - startedAt),
			error: error instanceof Error ? error.message : "unknown error",
		};
	}
}

export function toPublicHealth(health: DependencyHealth) {
	return { status: health.status, latencyMs: health.latencyMs };
}

export async function checkDatabase(): Promise<DependencyHealth> {
	return checkDependency(async () => {
		await db.execute(sql`select 1`);
	});
}

export async function checkRedis(): Promise<DependencyHealth> {
	return checkDependency(async () => {
		const redis = new Redis(redisUrl, {
			connectTimeout: 1000,
			lazyConnect: true,
			maxRetriesPerRequest: 1,
		});
		try {
			await redis.connect();
			await redis.ping();
		} finally {
			await redis.quit().catch(() => undefined);
		}
	});
}
