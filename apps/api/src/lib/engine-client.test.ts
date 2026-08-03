import { describe, expect, it, mock, beforeEach, spyOn } from "bun:test";
import { engineClient } from "./engine-client";
import { logger } from "./logger";

describe("EngineClient", () => {
	beforeEach(() => {
		mock.restore();
		delete process.env.INTERNAL_SERVICE_TOKEN;
	});

	it("should return ok and not throw when triggerDataFetch succeeds", async () => {
		process.env.INTERNAL_SERVICE_TOKEN = "test-internal-token";
		const fetchMock = mock(async () => {
			return new Response(JSON.stringify({ status: "accepted" }), { status: 200 });
		}) as any;
		global.fetch = fetchMock;

		// Should resolve without error
		await expect(engineClient.triggerDataFetch("sh.600000", 250)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-internal-token",
				}),
			}),
		);
		delete process.env.INTERNAL_SERVICE_TOKEN;
	});

	it("should use fail-soft strategy and not throw when triggerDataFetch fails (network error)", async () => {
		const fetchMock = mock(async () => {
			throw new Error("Network connection failed");
		}) as any;
		global.fetch = fetchMock;
		
		const loggerSpy = spyOn(logger, "error").mockImplementation(() => {});

		// Should resolve without error (fail-soft)
		await expect(engineClient.triggerDataFetch("sh.600000", 250)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(loggerSpy).toHaveBeenCalled();
	});

	it("should use fail-soft strategy and not throw when triggerDataFetch returns 500", async () => {
		const fetchMock = mock(async () => {
			return new Response("Internal Server Error", { status: 500 });
		}) as any;
		global.fetch = fetchMock;
		
		const loggerSpy = spyOn(logger, "warn").mockImplementation(() => {});

		// Should resolve without error (fail-soft)
		await expect(engineClient.triggerDataFetch("sh.600000", 250)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(loggerSpy).toHaveBeenCalled();
	});

	it("returns the typed project DTO for unified LLM chat", async () => {
		const fetchMock = mock(async () =>
			new Response(
				JSON.stringify({
					content: "hello",
					provider: "openai",
					model: "openai/gpt-5",
					usage: null,
				}),
				{ status: 200 },
			),
		) as any;
		global.fetch = fetchMock;

		const result = await engineClient.chatLlm({
			userId: "user-1",
			modelId: "model-1",
			messages: [{ role: "user", content: "hi" }],
		});

		expect(result.content).toBe("hello");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("normalizes sanitized Engine LLM errors without fail-soft fallback", async () => {
		global.fetch = mock(async () =>
			new Response(
				JSON.stringify({
					code: "LLM_CONFIG_NOT_FOUND",
					message: "大模型配置不存在或无权访问",
				}),
				{ status: 404 },
			),
		) as any;

		await expect(
			engineClient.testLlm("user-1", "model-1"),
		).rejects.toEqual(
			expect.objectContaining({
				code: "LLM_CONFIG_NOT_FOUND",
				status: 404,
			}),
		);
	});
});
