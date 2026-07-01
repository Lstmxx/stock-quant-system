import { db, alphaFactors } from "@stock-quant/database";
import { eq, desc } from "drizzle-orm";

export abstract class FactorService {
	static async listByUser(userId: string, limit: number = 50, offset: number = 0) {
		return await db
			.select()
			.from(alphaFactors)
			.where(eq(alphaFactors.userId, userId))
			.orderBy(desc(alphaFactors.icValue))
			.limit(limit)
			.offset(offset);
	}
}
