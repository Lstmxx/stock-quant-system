import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import { engineClient } from "../../lib/engine-client";
import {
	LlmService,
	toLlmModelView,
} from "./service";


describe("LlmService public contract", () => {
	afterEach(() => mock.restore());

	it("exposes only hasApiKey instead of owner or secret material", () => {
		const view = toLlmModelView({
			id: "model-1",
			userId: "user-1",
			provider: "openai",
			modelName: "gpt-5",
			name: "Primary",
			baseUrl: null,
			apiKey: "v1:ciphertext",
			isDefault: true,
			createdAt: new Date("2026-07-15T00:00:00Z"),
			updatedAt: new Date("2026-07-15T00:00:00Z"),
		});

		expect(view.hasApiKey).toBe(true);
		expect(view).not.toHaveProperty("apiKey");
		expect(view).not.toHaveProperty("userId");
	});

	it("resolves the user's default model before calling the Engine adapter", async () => {
		spyOn(LlmService, "getDefaultId").mockResolvedValue("model-1");
		const chatSpy = spyOn(engineClient, "chatLlm").mockResolvedValue({
			content: "ok",
			provider: "openai",
			model: "openai/gpt-5",
			usage: null,
		});

		await LlmService.chatDefault("user-1", {
			messages: [{ role: "user", content: "hello" }],
			jsonMode: true,
		});

		expect(chatSpy).toHaveBeenCalledWith({
			userId: "user-1",
			modelId: "model-1",
			messages: [{ role: "user", content: "hello" }],
			jsonMode: true,
		});
	});

	it("returns an actionable not-found error when no default exists", async () => {
		spyOn(LlmService, "getDefaultId").mockResolvedValue(null);

		await expect(LlmService.requireDefaultId("user-1")).rejects.toEqual(
			expect.objectContaining({
				code: "LLM_CONFIG_NOT_FOUND",
				status: 404,
			}),
		);
	});
});
