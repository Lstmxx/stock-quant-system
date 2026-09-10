import { alphaTasks, db, llmModels, userConfigs } from "@stock-quant/database";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { encrypt } from "../../lib/crypto";
import {
	engineClient,
	type EngineChatInput,
} from "../../lib/engine-client";
import type {
	CreateLlmInput,
	LlmModelView,
	LlmProvider,
	UpdateLlmInput,
} from "./model";
import {
	LlmValidationError,
	normalizeCreateLlmInput,
	normalizeUpdateLlmInput,
	validateBaseUrlNetworkBoundary,
	validateResolvedLlmConfig,
} from "./validation";

import { ApiDomainError } from "../../lib/api-response";

type LlmModelRow = typeof llmModels.$inferSelect;

export class LlmServiceError extends ApiDomainError {
	constructor(
		code: "LLM_CONFIG_NOT_FOUND" | "LLM_CONFIG_REFERENCED",
		message: string,
		status: 404 | 409,
	) {
		super(code, message, status);
		this.name = "LlmServiceError";
	}
}

export function toLlmModelView(model: LlmModelRow): LlmModelView {
	return {
		id: model.id,
		provider: model.provider as LlmProvider,
		modelName: model.modelName,
		name: model.name,
		baseUrl: model.baseUrl,
		hasApiKey: Boolean(model.apiKey),
		isDefault: model.isDefault,
		createdAt: model.createdAt,
		updatedAt: model.updatedAt,
	};
}

function notFound(): LlmServiceError {
	return new LlmServiceError(
		"LLM_CONFIG_NOT_FOUND",
		"大模型配置不存在或无权访问",
		404,
	);
}

export abstract class LlmService {
	static async listByUser(userId: string): Promise<LlmModelView[]> {
		const models = await db
			.select()
			.from(llmModels)
			.where(eq(llmModels.userId, userId))
			.orderBy(asc(llmModels.createdAt), asc(llmModels.id));
		return models.map(toLlmModelView);
	}

	static async getDefaultId(userId: string): Promise<string | null> {
		const [model] = await db
			.select({ id: llmModels.id })
			.from(llmModels)
			.where(
				and(eq(llmModels.userId, userId), eq(llmModels.isDefault, true)),
			)
			.limit(1);
		return model?.id ?? null;
	}

	static async create(userId: string, input: CreateLlmInput): Promise<LlmModelView> {
		const data = normalizeCreateLlmInput(input);
		await validateBaseUrlNetworkBoundary(data);
		const encryptedApiKey = data.apiKey ? encrypt(data.apiKey) : null;

		return db.transaction(async (tx) => {
			if (data.isDefault) {
				await tx
					.update(llmModels)
					.set({ isDefault: false, updatedAt: new Date() })
					.where(eq(llmModels.userId, userId));
			}
			const [created] = await tx
				.insert(llmModels)
				.values({ ...data, apiKey: encryptedApiKey, userId })
				.returning();
			return toLlmModelView(created);
		});
	}

	static async update(
		userId: string,
		id: string,
		input: UpdateLlmInput,
	): Promise<LlmModelView> {
		const update = normalizeUpdateLlmInput(input);

		return db.transaction(async (tx) => {
			const [current] = await tx
				.select()
				.from(llmModels)
				.where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)))
				.limit(1);
			if (!current) throw notFound();

			const nextApiKey =
				update.apiKeyAction === "replace"
					? encrypt(update.apiKey as string)
					: update.apiKeyAction === "clear"
						? null
						: current.apiKey;
			const resolved = {
				name: update.name ?? current.name,
				provider: (update.provider ?? current.provider) as LlmProvider,
				modelName: update.modelName ?? current.modelName,
				baseUrl:
					update.baseUrl !== undefined ? update.baseUrl : current.baseUrl,
				apiKey: nextApiKey ? "configured" : null,
				isDefault: update.isDefault ?? current.isDefault,
			};
			validateResolvedLlmConfig(resolved);
			await validateBaseUrlNetworkBoundary(resolved);

			if (resolved.isDefault) {
				await tx
					.update(llmModels)
					.set({ isDefault: false, updatedAt: new Date() })
					.where(eq(llmModels.userId, userId));
			}

			const [updated] = await tx
				.update(llmModels)
				.set({
					name: resolved.name,
					provider: resolved.provider,
					modelName: resolved.modelName,
					baseUrl: resolved.baseUrl,
					apiKey: nextApiKey,
					isDefault: resolved.isDefault,
					updatedAt: new Date(),
				})
				.where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)))
				.returning();
			return toLlmModelView(updated);
		});
	}

	static async delete(userId: string, id: string): Promise<{ success: true }> {
		return db.transaction(async (tx) => {
			const [current] = await tx
				.select({ id: llmModels.id })
				.from(llmModels)
				.where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)))
				.limit(1);
			if (!current) throw notFound();

			const [reference] = await tx
				.select({ id: userConfigs.id })
				.from(userConfigs)
				.where(
					and(
						eq(userConfigs.userId, userId),
						eq(userConfigs.key, "FACTOR_TASK_LLM_MODEL"),
						eq(userConfigs.value, id),
					),
				)
				.limit(1);
			if (reference) {
				throw new LlmServiceError(
					"LLM_CONFIG_REFERENCED",
					"该模型正被因子挖掘配置使用，请先选择其他模型",
					409,
				);
			}

			const [activeSelectionReference] = await tx
				.select({ id: alphaTasks.id })
				.from(alphaTasks)
				.where(
					and(
						eq(alphaTasks.userId, userId),
						eq(alphaTasks.type, "LLM_STOCK_SELECTION"),
						inArray(alphaTasks.status, ["PENDING", "RUNNING", "CANCELLING"]),
						sql`${alphaTasks.params}->>'llmModelId' = ${id}`,
					),
				)
				.limit(1);
			if (activeSelectionReference) {
				throw new LlmServiceError(
					"LLM_CONFIG_REFERENCED",
					"该模型正被运行中的 LLM 选股任务使用，请等待完成或先取消任务",
					409,
				);
			}

			await tx
				.delete(llmModels)
				.where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)));
			return { success: true };
		});
	}

	static async setDefault(userId: string, id: string): Promise<LlmModelView> {
		return db.transaction(async (tx) => {
			const [current] = await tx
				.select()
				.from(llmModels)
				.where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)))
				.limit(1);
			if (!current) throw notFound();

			await tx
				.update(llmModels)
				.set({ isDefault: false, updatedAt: new Date() })
				.where(eq(llmModels.userId, userId));
			const [updated] = await tx
				.update(llmModels)
				.set({ isDefault: true, updatedAt: new Date() })
				.where(and(eq(llmModels.id, id), eq(llmModels.userId, userId)))
				.returning();
			return toLlmModelView(updated);
		});
	}

	static async requireDefaultId(userId: string): Promise<string> {
		const id = await LlmService.getDefaultId(userId);
		if (!id) {
			throw new LlmServiceError(
				"LLM_CONFIG_NOT_FOUND",
				"尚未设置默认大模型，请先进入大模型配置页完成设置",
				404,
			);
		}
		return id;
	}

	static async chatDefault(
		userId: string,
		input: Omit<EngineChatInput, "userId" | "modelId">,
	) {
		const modelId = await LlmService.requireDefaultId(userId);
		return engineClient.chatLlm({ ...input, userId, modelId });
	}

	static async testConnection(userId: string, id: string) {
		return engineClient.testLlm(userId, id);
	}
}

export { LlmValidationError };
