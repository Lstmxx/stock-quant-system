import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

import { FactorQuery } from "./model";

const app = new Elysia().get("/factors", ({ query }) => query, {
	query: FactorQuery,
});

const query = (search: string) =>
	app.handle(new Request(`http://localhost/factors?${search}`));

describe("FactorQuery", () => {
	it("coerces bounded integer pagination", async () => {
		const response = await query("limit=20&offset=10");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ limit: 20, offset: 10 });
	});

	it("rejects negative, fractional, and oversized pagination", async () => {
		expect((await query("limit=0")).status).toBe(422);
		expect((await query("limit=101")).status).toBe(422);
		expect((await query("offset=-1")).status).toBe(422);
		expect((await query("limit=1.5")).status).toBe(422);
	});
});
