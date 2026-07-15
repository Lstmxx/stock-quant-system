import { db, userConfigs } from "@stock-quant/database";
import { eq } from "drizzle-orm";

export abstract class ConfigService {
	static async listByUser(userId: string) {
		return await db
			.select()
			.from(userConfigs)
			.where(eq(userConfigs.userId, userId));
	}

	static async upsert(userId: string, key: string, value: string) {
		await db
			.insert(userConfigs)
			.values({ userId, key, value })
			.onConflictDoUpdate({
				target: [userConfigs.userId, userConfigs.key],
				set: { value, updatedAt: new Date() },
			});

		return { success: true };
	}
}
