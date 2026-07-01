import { describe, expect, it, mock, beforeEach, spyOn } from "bun:test";
import { engineClient } from "./engine-client";

describe("EngineClient", () => {
	beforeEach(() => {
		mock.restore();
	});

	it("should return ok and not throw when triggerDataFetch succeeds", async () => {
		const fetchMock = mock(async () => {
			return new Response(JSON.stringify({ status: "accepted" }), { status: 200 });
		}) as any;
		global.fetch = fetchMock;

		// Should resolve without error
		await expect(engineClient.triggerDataFetch("sh.600000", 250)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("should use fail-soft strategy and not throw when triggerDataFetch fails (network error)", async () => {
		const fetchMock = mock(async () => {
			throw new Error("Network connection failed");
		}) as any;
		global.fetch = fetchMock;
		
		const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

		// Should resolve without error (fail-soft)
		await expect(engineClient.triggerDataFetch("sh.600000", 250)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(consoleSpy).toHaveBeenCalled();
	});

	it("should use fail-soft strategy and not throw when triggerDataFetch returns 500", async () => {
		const fetchMock = mock(async () => {
			return new Response("Internal Server Error", { status: 500 });
		}) as any;
		global.fetch = fetchMock;
		
		const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

		// Should resolve without error (fail-soft)
		await expect(engineClient.triggerDataFetch("sh.600000", 250)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(consoleSpy).toHaveBeenCalled();
	});
});
