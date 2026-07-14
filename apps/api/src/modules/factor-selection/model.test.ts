import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

import { CreateFactorSelectionBody } from "./model";

const app = new Elysia().post("/factor-selections", ({ body }) => body, {
	body: CreateFactorSelectionBody,
});

const submit = (body: unknown) =>
	app.handle(
		new Request("http://localhost/factor-selections", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);

describe("CreateFactorSelectionBody", () => {
	it("accepts the two supported universe types", async () => {
		expect((await submit({ universeType: "ALL_MARKET", topN: 20 })).status).toBe(200);
		expect((await submit({ universeType: "WATCHLIST", topN: 10 })).status).toBe(200);
	});

	it("rejects unsupported universes and unsafe Top N values", async () => {
		expect((await submit({ universeType: "INDEX", topN: 20 })).status).toBe(422);
		expect((await submit({ universeType: "ALL_MARKET", topN: 0 })).status).toBe(422);
		expect((await submit({ universeType: "ALL_MARKET", topN: 101 })).status).toBe(422);
	});
});
