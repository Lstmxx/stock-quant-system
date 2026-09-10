import { createHash } from "node:crypto";

import {
	alphaFactors,
	alphaTasks,
	db,
	factorSelectionResults,
	userSelectedFactors,
	watchlists,
} from "@stock-quant/database";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";

import { TaskService } from "../task/service";
import type { CreateFactorSelectionBody } from "./model";

export type SelectionMode = "AUTO" | "MANUAL";

export async function resolveFactorSet(userId: string) {
	const selected = await db
		.select({ factor: alphaFactors })
		.from(userSelectedFactors)
		.innerJoin(
			alphaFactors,
			and(
				eq(alphaFactors.id, userSelectedFactors.factorId),
				eq(alphaFactors.userId, userId),
				eq(alphaFactors.isValid, true),
			),
		)
		.where(eq(userSelectedFactors.userId, userId))
		.orderBy(asc(alphaFactors.id));

	if (selected.length > 0) {
		return { mode: "MANUAL" as const, factors: selected.map((row) => row.factor) };
	}

	const factors = await db
		.select()
		.from(alphaFactors)
		.where(and(eq(alphaFactors.userId, userId), eq(alphaFactors.isValid, true)))
		.orderBy(
			desc(sql`abs(coalesce(${alphaFactors.icValue}, 0))`),
			desc(sql`abs(coalesce(${alphaFactors.icir}, 0))`),
			asc(alphaFactors.id),
		)
		.limit(5);
	return { mode: "AUTO" as const, factors };
}

function shanghaiDate(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

export abstract class FactorSelectionService {
	static async create(userId: string, body: CreateFactorSelectionBody) {
		const { mode, factors } = await resolveFactorSet(userId);
		if (factors.length === 0) {
			return { success: false as const, code: "FACTOR_SET_EMPTY" as const, error: "暂无有效因子，请先完成因子挖掘" };
		}

		const factorIds = [...new Set(factors.map((factor) => factor.id))].sort();
		const factorSetHash = createHash("sha256").update(factorIds.join(",")).digest("hex");
		let symbols: string[] | undefined;
		if (body.universeType === "WATCHLIST") {
			const rows = await db
				.select({ symbol: watchlists.symbol })
				.from(watchlists)
				.where(eq(watchlists.userId, userId));
			symbols = [...new Set(rows.map((row) => row.symbol))].sort();
			if (symbols.length === 0) {
				return { success: false as const, code: "WATCHLIST_EMPTY" as const, error: "自选股为空，请先添加自选股" };
			}
		}

		const params = {
			factorIds,
			factorSetHash,
			selectionMode: mode,
			universeType: body.universeType,
			...(symbols ? { symbols } : {}),
			topN: body.topN,
			dataDate: shanghaiDate(),
			lookbackDays: body.lookbackDays ?? 250,
		};
		const [task] = await db
			.insert(alphaTasks)
			.values({ userId, type: "FACTOR_SELECTION", status: "PENDING", params })
			.returning();

		const enqueued = await TaskService.enqueueTask(task.id, {
			taskId: task.id,
			userId,
			type: "FACTOR_SELECTION",
			params,
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

	static async list(userId: string, limit = 20, offset = 0) {
		const condition = and(
			eq(alphaTasks.userId, userId),
			eq(alphaTasks.type, "FACTOR_SELECTION"),
		);
		const [totalRow] = await db
			.select({ count: count() })
			.from(alphaTasks)
			.where(condition);
		const data = await db
			.select()
			.from(alphaTasks)
			.where(condition)
			.orderBy(desc(alphaTasks.createdAt))
			.limit(limit)
			.offset(offset);
		return { data, total: totalRow.count };
	}

	static async detail(userId: string, taskId: string) {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(
				and(
					eq(alphaTasks.id, taskId),
					eq(alphaTasks.userId, userId),
					eq(alphaTasks.type, "FACTOR_SELECTION"),
				),
			);
		if (!task) return null;

		const params = (task.params ?? {}) as { topN?: number };
		const results = await db
			.select()
			.from(factorSelectionResults)
			.where(
				and(
					eq(factorSelectionResults.taskId, taskId),
					eq(factorSelectionResults.userId, userId),
				),
			)
			.orderBy(asc(factorSelectionResults.rank))
			.limit(params.topN ?? 20);
		return { task, results };
	}
}
