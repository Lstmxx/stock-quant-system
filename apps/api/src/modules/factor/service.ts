import { db, alphaFactors } from "@stock-quant/database";
import { eq, desc, and, ilike, or, count } from "drizzle-orm";

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
}
