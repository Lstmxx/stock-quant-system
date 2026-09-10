import { db, alphaFactors, userSelectedFactors } from "@stock-quant/database";
import { eq, desc, and, ilike, or, count, inArray } from "drizzle-orm";

import { resolveFactorSet } from "../factor-selection/service";

export abstract class FactorService {
	static async listByUser(userId: string, limit: number = 50, offset: number = 0, keyword?: string) {
		const conditions = keyword
			? and(
					eq(alphaFactors.userId, userId),
					or(
						ilike(alphaFactors.name, `%${keyword}%`),
						ilike(alphaFactors.expression, `%${keyword}%`)
					)
			  )
			: eq(alphaFactors.userId, userId);

		const [totalRecord] = await db
			.select({ count: count() })
			.from(alphaFactors)
			.where(conditions);

		const data = await db
			.select()
			.from(alphaFactors)
			.where(conditions)
			.orderBy(desc(alphaFactors.icValue))
			.limit(limit)
			.offset(offset);

		return {
			data,
			total: totalRecord.count,
		};
	}

	static async getSelectedFactors(userId: string) {
		const resolved = await resolveFactorSet(userId);
		return {
			mode: resolved.mode,
			factorIds: resolved.factors.map((factor) => factor.id),
			factors: resolved.factors,
		};
	}

	static async setSelectedFactors(userId: string, requestedIds: string[]) {
		const factorIds = [...new Set(requestedIds)].sort();
		if (factorIds.length !== requestedIds.length) {
			return { success: false as const, code: "FACTOR_IDS_DUPLICATED" as const, error: "因子集合中存在重复项" };
		}

		if (factorIds.length > 0) {
			const owned = await db
				.select({ id: alphaFactors.id })
				.from(alphaFactors)
				.where(
					and(
						eq(alphaFactors.userId, userId),
						eq(alphaFactors.isValid, true),
						inArray(alphaFactors.id, factorIds),
					),
				);
			if (owned.length !== factorIds.length) {
				return {
					success: false as const,
					code: "FACTOR_IDS_INVALID" as const,
					error: "所选因子包含不存在、无效或不属于当前用户的记录",
				};
			}
		}

		await db.transaction(async (tx) => {
			await tx
				.delete(userSelectedFactors)
				.where(eq(userSelectedFactors.userId, userId));
			if (factorIds.length > 0) {
				await tx.insert(userSelectedFactors).values(
					factorIds.map((factorId) => ({ userId, factorId })),
				);
			}
		});
		return { success: true as const, mode: factorIds.length > 0 ? "MANUAL" : "AUTO" };
	}
}
