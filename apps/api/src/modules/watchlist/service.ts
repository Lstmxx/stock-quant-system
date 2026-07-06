import { db, watchlists } from "@stock-quant/database";
import { eq, and } from "drizzle-orm";

export abstract class WatchlistService {
	static async listByUser(userId: string) {
		return await db
			.select()
			.from(watchlists)
			.where(eq(watchlists.userId, userId));
	}

	static async create(userId: string, symbol: string, name?: string) {
		const [item] = await db
			.insert(watchlists)
			.values({ userId, symbol, name })
			.returning();
		return item;
	}

	static async remove(userId: string, id: string) {
		await db
			.delete(watchlists)
			.where(and(eq(watchlists.id, id), eq(watchlists.userId, userId)));
		return { success: true };
	}
}
