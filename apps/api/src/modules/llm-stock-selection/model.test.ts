import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

import {
	CreateLlmStockSelectionBody,
	decodeLlmStockSelectionParams,
	decodeLlmStockSelectionSummary,
	RetryFailedLlmStockSelectionBody,
} from "./model";

const app = new Elysia()
	.post("/create", ({ body }) => body, { body: CreateLlmStockSelectionBody })
	.post("/retry", ({ body }) => body, { body: RetryFailedLlmStockSelectionBody });

async function submit(path: "/create" | "/retry", body: object) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("LLM stock selection models", () => {
	it("accepts the configured bounds", async () => {
		expect(
			(
				await submit("/create", {
					llmModelId: "model-1",
					candidateCount: 20,
					finalTopN: 1,
					lookbackDays: 120,
				})
			).status,
		).toBe(200);
		expect(
			(
				await submit("/create", {
					llmModelId: "model-1",
					candidateCount: 100,
					finalTopN: 20,
					lookbackDays: 500,
				})
			).status,
		).toBe(200);
	});

	it("rejects unsafe candidate and lookback values", async () => {
		expect(
			(
				await submit("/create", {
					llmModelId: "model-1",
					candidateCount: 19,
					finalTopN: 10,
					lookbackDays: 250,
				})
			).status,
		).toBe(422);
		expect(
			(
				await submit("/create", {
					llmModelId: "model-1",
					candidateCount: 50,
					finalTopN: 21,
					lookbackDays: 119,
				})
			).status,
		).toBe(422);
	});

	it("limits retry subsets and rejects duplicates", async () => {
		expect(
			(await submit("/retry", { symbols: ["sh.600000"] })).status,
		).toBe(200);
		expect(
			(
				await submit("/retry", {
					symbols: ["sh.600000", "sh.600000"],
				})
			).status,
		).toBe(422);
	});

	it("decodes task JSON at one shared boundary", () => {
		const params = decodeLlmStockSelectionParams({
			llmModelId: "model-1",
			llmProvider: "openai",
			llmModelName: "gpt-test",
			llmModelDisplayName: "Primary",
			candidateCount: 50,
			finalTopN: 10,
			lookbackDays: 250,
			factorIds: ["factor-1"],
			factorSetHash: "hash",
			selectionMode: "MANUAL",
			watchlistSymbols: ["sh.600000"],
		});
		expect(params?.selectionMode).toBe("MANUAL");
		expect(params?.llmModelDisplayName).toBe("Primary");
		expect(params?.horizonTradingDays).toBe(20);

		expect(
			decodeLlmStockSelectionSummary({ dataDate: "2026-07-15", totalTokens: 123 }),
		).toEqual({ dataDate: "2026-07-15", totalTokens: 123 });
	});
});
