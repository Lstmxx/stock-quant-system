import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

import { CreateMiningTaskBody } from "./model";

const app = new Elysia().post("/mining", ({ body }) => body, {
	body: CreateMiningTaskBody,
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
