import { describe, expect, test } from "bun:test";

import {
	LlmValidationError,
	normalizeCreateLlmInput,
	normalizeUpdateLlmInput,
	validateBaseUrlNetworkBoundary,
} from "./validation";

describe("LLM model input contract", () => {
	test("normalizes a hosted OpenAI model", () => {
		expect(
			normalizeCreateLlmInput({
				name: "  Primary GPT  ",
				provider: "openai",
				modelName: " gpt-5 ",
				apiKey: " sk-secret ",
			}),
		).toEqual({
			name: "Primary GPT",
			provider: "openai",
			modelName: "gpt-5",
			baseUrl: null,
			apiKey: "sk-secret",
			isDefault: false,
		});
	});

	test("allows Ollama without an API key", () => {
		const result = normalizeCreateLlmInput({
			name: "Local model",
			provider: "ollama",
			modelName: "qwen3:8b",
		});

		expect(result.apiKey).toBeNull();
		expect(result.baseUrl).toBeNull();
	});

	test("rejects invalid provider field combinations", () => {
		expect(() =>
			normalizeCreateLlmInput({
				name: "Anthropic",
				provider: "anthropic",
				modelName: "claude-sonnet-4-5",
			}),
		).toThrow(LlmValidationError);

		expect(() =>
			normalizeCreateLlmInput({
				name: "Hosted OpenAI",
				provider: "openai",
				modelName: "gpt-5",
				apiKey: "secret",
				baseUrl: "https://example.com/v1",
			}),
		).toThrow("Base URL");

		expect(() =>
			normalizeCreateLlmInput({
				name: "Compatible",
				provider: "openai_compatible",
				modelName: "custom-model",
				apiKey: "secret",
			}),
		).toThrow("Base URL");
	});

	test("uses explicit key actions for updates", () => {
		expect(
			normalizeUpdateLlmInput({ apiKeyAction: "replace", apiKey: " new-key " }),
		).toEqual({ apiKeyAction: "replace", apiKey: "new-key" });
		expect(() =>
			normalizeUpdateLlmInput({ apiKeyAction: "keep", apiKey: "unexpected" }),
		).toThrow("apiKey");
		expect(() => normalizeUpdateLlmInput({ apiKeyAction: "replace" })).toThrow(
			"apiKey",
		);
	});

	test("rejects private custom endpoints unless explicitly enabled", async () => {
		const config = normalizeCreateLlmInput({
			name: "Compatible",
			provider: "openai_compatible",
			modelName: "custom-model",
			apiKey: "secret",
			baseUrl: "https://gateway.example.com/v1",
		});

		await expect(
			validateBaseUrlNetworkBoundary(config, async () => [
				{ address: "10.0.0.8" },
			]),
		).rejects.toThrow("私网");

		await expect(
			validateBaseUrlNetworkBoundary(config, async () => [
				{ address: "8.8.8.8" },
			]),
		).resolves.toBeUndefined();
	});
});
