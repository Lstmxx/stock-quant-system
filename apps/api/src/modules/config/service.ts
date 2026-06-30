import { db, userConfigs } from "@stock-quant/database";
import { eq, and } from "drizzle-orm";

export abstract class ConfigService {
	static async listByUser(userId: string) {
		return await db
			.select()
			.from(userConfigs)
			.where(eq(userConfigs.userId, userId));
	}

	static async upsert(userId: string, key: string, value: string) {
		const existing = await db
			.select()
			.from(userConfigs)
			.where(and(eq(userConfigs.userId, userId), eq(userConfigs.key, key)));

		if (existing.length > 0) {
			await db
				.update(userConfigs)
				.set({ value, updatedAt: new Date() })
				.where(eq(userConfigs.id, existing[0].id));
		} else {
			await db.insert(userConfigs).values({ userId, key, value });
		}

		return { success: true };
	}
}
