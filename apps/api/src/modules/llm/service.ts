import { db, llmModels } from "@stock-quant/database";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "../../lib/crypto";

export class LlmService {
    static async listByUser(userId: string) {
        const models = await db.select().from(llmModels).where(eq(llmModels.userId, userId));
        return models.map(m => ({
            ...m,
            // 脱敏 apiKey，只告诉前端是否配置了
            apiKey: m.apiKey ? "********" : "",
        }));
    }

    static async getById(userId: string, id: string) {
        const models = await db.select().from(llmModels).where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)));
        if (models.length === 0) return null;
        const model = models[0];
        return {
            ...model,
            apiKey: decrypt(model.apiKey || "")
        };
    }

    static async create(userId: string, data: any) {
        if (data.isDefault) {
            await this.clearDefault(userId);
        }
        
        const insertData = { ...data, userId };
        if (data.apiKey) {
            insertData.apiKey = encrypt(data.apiKey);
        }

        const res = await db.insert(llmModels).values(insertData).returning();
        return res[0];
    }

    static async update(userId: string, id: string, data: any) {
        if (data.isDefault) {
            await this.clearDefault(userId);
        }

        const updateData = { ...data, updatedAt: new Date() };
        if (data.apiKey !== undefined) {
            if (data.apiKey === "********" || data.apiKey === "") {
                delete updateData.apiKey; // 忽略修改
            } else {
                updateData.apiKey = encrypt(data.apiKey);
            }
        }

        const res = await db.update(llmModels)
            .set(updateData)
            .where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)))
            .returning();
        return res[0];
    }

    static async delete(userId: string, id: string) {
        await db.delete(llmModels).where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)));
        return { success: true };
    }

    static async setDefault(userId: string, id: string) {
        await this.clearDefault(userId);
        const res = await db.update(llmModels)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)))
            .returning();
        return res[0];
    }

    private static async clearDefault(userId: string) {
        await db.update(llmModels)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(llmModels.userId, userId));
    }
}
