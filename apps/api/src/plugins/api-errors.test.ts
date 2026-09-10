import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Elysia, t } from "elysia";
import { ApiCode } from "../contracts/api-response";
import { ApiDomainError, apiSuccess } from "../lib/api-response";
import { EngineClientError } from "../lib/engine-client";
import { logger } from "../lib/logger";
import { apiErrors, mapEngineError } from "./api-errors";

describe("API error boundary", () => {
	afterEach(() => mock.restore());

	it("keeps scoped/grouped domain errors separate from success payloads", async () => {
		spyOn(logger, "error").mockImplementation(() => {});
		const routes = new Elysia().use(apiErrors)
			.get("/ok", () => apiSuccess({ value: 1 }))
			.get("/missing", () => { throw new ApiDomainError("KLINE_NOT_FOUND", "暂无行情", 404); })
			.post("/validate", ({ body }) => apiSuccess(body), { body: t.Object({ value: t.Number() }) });
		const app = new Elysia().use(apiErrors).group("/api", (group) => group.use(routes));
		for (const [path, statusCode, code] of [
			["/api/ok", 200, ApiCode.SUCCESS],
			["/api/missing", 404, ApiCode.KLINE_NOT_FOUND],
			["/api/unknown", 404, ApiCode.NOT_FOUND],
		] as const) {
			const response = await app.handle(new Request(`http://localhost${path}`));
			expect(response.status).toBe(statusCode);
			expect(await response.json()).toMatchObject({ success: statusCode === 200, code });
		}
		const invalid = await app.handle(new Request("http://localhost/api/validate", {
			method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "invalid" }),
		}));
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toMatchObject({ success: false, code: ApiCode.VALIDATION_ERROR, data: null });
	});

	it("sanitizes unexpected errors without wrapping special success responses", async () => {
		const log = spyOn(logger, "error").mockImplementation(() => {});
		const app = new Elysia().use(apiErrors)
			.get("/failure", () => { throw new Error("database-password"); })
			.get("/health", () => ({ status: "ok" }))
			.get("/native", () => new Response("native"));
		const failure = await app.handle(new Request("http://localhost/failure"));
		expect(failure.status).toBe(500);
		expect(await failure.json()).toEqual({ success: false, code: ApiCode.INTERNAL_ERROR, message: "服务器内部错误", data: null });
		expect(log).toHaveBeenCalledTimes(1);
		expect(await (await app.handle(new Request("http://localhost/health"))).json()).toEqual({ status: "ok" });
		expect(await (await app.handle(new Request("http://localhost/native"))).text()).toBe("native");
	});

	it.each([
		["LLM_CONFIG_NOT_FOUND", 404, 404, ApiCode.LLM_CONFIG_NOT_FOUND],
		["LLM_CONFIG_INVALID", 422, 422, ApiCode.LLM_CONFIG_INVALID],
		["LLM_SECRET_INVALID", 422, 422, ApiCode.LLM_SECRET_INVALID],
		["LLM_AUTH_FAILED", 502, 502, ApiCode.LLM_AUTH_FAILED],
		["LLM_RATE_LIMITED", 502, 502, ApiCode.LLM_RATE_LIMITED],
		["LLM_RESPONSE_INVALID", 502, 502, ApiCode.LLM_RESPONSE_INVALID],
		["LLM_TIMEOUT", 504, 504, ApiCode.LLM_TIMEOUT],
		["LLM_PROVIDER_UNAVAILABLE", 401, 502, ApiCode.UPSTREAM_AUTH_ERROR],
		["UNKNOWN", 403, 502, ApiCode.UPSTREAM_AUTH_ERROR],
		["UNKNOWN", 503, 503, ApiCode.LLM_PROVIDER_UNAVAILABLE],
		["UNKNOWN", 418, 502, ApiCode.LLM_PROVIDER_UNAVAILABLE],
	] as const)("maps Engine %s/%i without leaking internal detail", (code, internalStatus, httpStatus, publicCode) => {
		const mapped = mapEngineError(new EngineClientError(code, "private engine detail", internalStatus));
		expect(mapped.status).toBe(httpStatus);
		expect(mapped.code).toBe(publicCode);
		expect(mapped.message).not.toContain("private");
	});
});
