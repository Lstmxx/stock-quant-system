import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

import { CreateMiningTaskBody, parseWorkerProgress } from "./model";

const app = new Elysia().post("/mining", ({ body }) => body, {
	body: CreateMiningTaskBody,
});

describe("worker progress boundary", () => {
	const worker = { worker_id: 1, total: 2, success: 0, failed: 2, current_code: null, status: "failed" };

	it("retains Engine field names and partial/failure states", () => {
		expect(parseWorkerProgress(JSON.stringify(worker))).toEqual(worker);
		expect(parseWorkerProgress(JSON.stringify({ ...worker, status: "partial", current_code: "sh.600519" })))
			.toMatchObject({ status: "partial", current_code: "sh.600519" });
	});

	it("normalizes an omitted current symbol without accepting arbitrary worker objects", () => {
		const { current_code, ...withoutSymbol } = worker;
		expect(parseWorkerProgress(JSON.stringify(withoutSymbol))).toEqual(worker);
		for (const invalid of [
			null, [], {}, { ...worker, worker_id: -1 }, { ...worker, total: 1.5 },
			{ ...worker, success: "1" }, { ...worker, failed: -1 },
			{ ...worker, status: "unknown" }, { ...worker, current_code: 600519 },
		]) {
			expect(parseWorkerProgress(JSON.stringify(invalid))).toBeNull();
		}
		expect(parseWorkerProgress("invalid JSON")).toBeNull();
	});
});
async function submit(body: unknown): Promise<Response> {
	return app.handle(
		new Request("http://localhost/mining", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("CreateMiningTaskBody", () => {
	it("accepts a supported research direction", async () => {
		const response = await submit({
			researchDirection: "动量反转",
			days: 250,
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			researchDirection: "动量反转",
			days: 250,
		});
	});

	it("rejects a stock symbol and out-of-range lookback", async () => {
		const stockSymbol = await submit({
			researchDirection: "sh.000300",
			days: 250,
		});
		const shortLookback = await submit({
			researchDirection: "量价关系",
			days: 9,
		});

		expect(stockSymbol.status).toBe(422);
		expect(shortLookback.status).toBe(422);
	});
});
