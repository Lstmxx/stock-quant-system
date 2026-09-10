import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import Redis from "ioredis";
import { alphaFactors, db } from "@stock-quant/database";
import { createApp, type App } from "../src/app";
import { ApiCode, type ApiErrorCode } from "../src/contracts/api-response";
import { engineClient } from "../src/lib/engine-client";
import * as health from "../src/lib/health";
import { logger } from "../src/lib/logger";
import { ConfigService } from "../src/modules/config/service";
import { FactorSelectionService } from "../src/modules/factor-selection/service";
import { FactorService } from "../src/modules/factor/service";
import { LlmStockSelectionService, LlmStockSelectionServiceError } from "../src/modules/llm-stock-selection/service";
import { LlmService, LlmServiceError } from "../src/modules/llm/service";
import { LlmValidationError } from "../src/modules/llm/validation";
import { MarketDataError, MarketDataService } from "../src/modules/market-data/service";
import { StrategyService } from "../src/modules/strategy/service";
import * as taskService from "../src/modules/task/service";
import { WatchlistService } from "../src/modules/watchlist/service";
import { auth } from "../src/plugins/auth";

const { TaskService } = taskService;
const now = new Date("2026-09-09T00:00:00Z");
const session = {
	user: { id: "user-1", name: "Tester", email: "tester@example.com", emailVerified: true, createdAt: now, updatedAt: now, image: null },
	session: { id: "session-1", userId: "user-1", token: "test-token", expiresAt: new Date("2099-01-01"), createdAt: now, updatedAt: now, ipAddress: null, userAgent: null },
};
const task = { id: "task-1", userId: "user-1", type: "DATA_COLLECTION", status: "RUNNING", params: null, result: null, createdAt: now, updatedAt: now };
const selectionTask = { ...task, type: "LLM_STOCK_SELECTION", result: {} };
const model = { id: "model-1", name: "Model", provider: "openai" as const, modelName: "gpt-test", baseUrl: null, hasApiKey: true, isDefault: true, createdAt: now, updatedAt: now };
const watchlist = { id: "watch-1", userId: "user-1", symbol: "sh.600519", name: "贵州茅台", createdAt: now, updatedAt: now };
const config = { lookbackDays: 250, workerCount: 4, cronExpression: "0 20 * * mon-fri" };
const collectionList = { items: [task], total: 1, limit: 50, offset: 0, activeTask: task };
const selectionList = { items: [selectionTask], total: 1, limit: 20, offset: 0, activeTask: selectionTask };
const worker = { worker_id: 1, total: 2, success: 0, failed: 2, current_code: null, status: "failed" };
const failures = { taskId: "task-1", stocks: ["sh.600519"], failures: [{ code: "sh.600519", reason: "source unavailable" }] };
const factorSet = { mode: "AUTO" as const, factorIds: [], factors: [] };
const factorDetail = { task, results: [] };
const results = { task: selectionTask, items: [], total: 0 };
const candidate = {
	id: "result-1", taskId: "task-1", userId: "user-1", symbol: "sh.600519", stockName: null, dataDate: "2026-09-09",
	universeStatus: "ELIGIBLE" as const, exclusionStage: null, exclusionCode: null, exclusionMessage: null, excludedAt: null,
	quantitativeScore: null, quantitativeRank: null, candidateSources: [], isLlmCandidate: true, inputSnapshot: null,
	llmStatus: "FAILED" as const, judgment: null, attemptCount: 1, latestErrorCode: "LLM_TIMEOUT", latestErrorMessage: "timeout",
	latestErrorAt: now, selected: false, finalRank: null, promptTokens: 0, completionTokens: 0, totalTokens: 0, createdAt: now, updatedAt: now,
};
const stockDetail = { result: candidate, attempts: [] };
const chart = {
	symbol: "sh.600519", name: "贵州茅台", bars: [], volume: [],
	latest: { time: "2026-09-09", open: 1, high: 2, low: 1, close: 2, volume: 100, changePercent: null },
	range: { start: "2026-09-09", end: "2026-09-09" },
};
const simulation = { factorId: "factor-1", annualReturn: 0.1, maxDrawdown: null, sharpeRatio: null, winRate: null, ic: 0.1 };
const selectionInput = { llmModelId: "model-1", candidateCount: 50, finalTopN: 10, lookbackDays: 250 };
const factorSelectionInput = { universeType: "ALL_MARKET", topN: 20, lookbackDays: 250 };
const createModelInput = { provider: "openai", modelName: "gpt-test", name: "Model", apiKey: "private-key" };

interface SuccessCase {
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	data: unknown;
	body?: unknown;
}

const successCases: SuccessCase[] = [
	{ method: "GET", path: "/api/config", data: [] },
	{ method: "POST", path: "/api/config", body: { key: "FACTOR_TASK_LLM_MODEL", value: "model-1" }, data: null },
	{ method: "GET", path: "/api/watchlists", data: [watchlist] },
	{ method: "POST", path: "/api/watchlists", body: { symbol: "sh.600519", name: "贵州茅台" }, data: watchlist },
	{ method: "DELETE", path: "/api/watchlists/watch-1", data: null },
	{ method: "GET", path: "/api/tasks", data: [task] },
	{ method: "POST", path: "/api/tasks/mining", body: { researchDirection: "量价关系", days: 250 }, data: { taskId: "task-1" } },
	{ method: "GET", path: "/api/tasks/data-collection", data: collectionList },
	{ method: "GET", path: "/api/tasks/data-collection/config", data: config },
	{ method: "PUT", path: "/api/tasks/data-collection/config", body: config, data: null },
	{ method: "POST", path: "/api/tasks/data-collection/run", data: { taskId: "task-1" } },
	{ method: "GET", path: "/api/tasks/data-collection/stock-names?codes=sh.600519", data: { "sh.600519": "贵州茅台" } },
	{ method: "GET", path: "/api/tasks/task-1/status", data: task },
	{ method: "POST", path: "/api/tasks/task-1/cancel", data: { status: "CANCELLING" } },
	{ method: "GET", path: "/api/tasks/task-1/progress", data: { taskId: "task-1", status: "RUNNING", workers: [worker] } },
	{ method: "GET", path: "/api/tasks/task-1/failed-stocks", data: failures },
	{ method: "POST", path: "/api/tasks/task-1/retry-failed", data: { taskId: "task-2", stockCount: 1 } },
	{ method: "GET", path: "/api/tasks/task-1/logs?offset=0", data: { logs: ["log"], nextOffset: 1 } },
	{ method: "GET", path: "/api/factors", data: { data: [], total: 0 } },
	{ method: "GET", path: "/api/factors/selection", data: factorSet },
	{ method: "PUT", path: "/api/factors/selection", body: { factorIds: [] }, data: { mode: "AUTO" } },
	{ method: "POST", path: "/api/factor-selections", body: factorSelectionInput, data: { taskId: "task-1" } },
	{ method: "GET", path: "/api/factor-selections", data: { data: [task], total: 1 } },
	{ method: "GET", path: "/api/factor-selections/task-1", data: factorDetail },
	{ method: "POST", path: "/api/strategy/recommend", body: { style: "Momentum" }, data: [] },
	{ method: "POST", path: "/api/strategy/simulate", body: { factorId: "factor-1" }, data: simulation },
	{ method: "POST", path: "/api/strategy/generate-report", body: { style: "Momentum", factorId: "factor-1", simulationResult: {} }, data: { summary: "report" } },
	{ method: "GET", path: "/api/llm", data: [model] },
	{ method: "POST", path: "/api/llm", body: createModelInput, data: model },
	{ method: "PUT", path: "/api/llm/model-1", body: { name: "Model" }, data: model },
	{ method: "DELETE", path: "/api/llm/model-1", data: null },
	{ method: "POST", path: "/api/llm/model-1/default", data: model },
	{ method: "POST", path: "/api/llm/model-1/test", data: { provider: "openai", model: "gpt-test" } },
	{ method: "POST", path: "/api/llm-stock-selections", body: selectionInput, data: { taskId: "task-1" } },
	{ method: "GET", path: "/api/llm-stock-selections", data: selectionList },
	{ method: "GET", path: "/api/llm-stock-selections/task-1", data: selectionTask },
	{ method: "GET", path: "/api/llm-stock-selections/task-1/results", data: results },
	{ method: "GET", path: "/api/llm-stock-selections/task-1/results/sh.600519", data: stockDetail },
	{ method: "POST", path: "/api/llm-stock-selections/task-1/cancel", data: { status: "CANCELLING" } },
	{ method: "POST", path: "/api/llm-stock-selections/task-1/retry-failed", body: {}, data: { taskId: "task-1", retryCount: 1 } },
	{ method: "GET", path: "/api/market-data/search?q=600519", data: [{ code: "sh.600519", name: "贵州茅台" }] },
	{ method: "GET", path: "/api/market-data/sh.600519/kline", data: chart },
];

let app: App;
let redis: Redis;
const simulateFactor = StrategyService.simulateFactor;

function send(method: string, path: string, body?: unknown) {
	return app.handle(new Request(`http://localhost${path}`, {
		method,
		headers: { "x-request-id": "contract-test", ...(body === undefined ? {} : { "content-type": "application/json" }) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
}

async function expectFailure(response: Response, status: number, code: ApiErrorCode) {
	expect(response.status).toBe(status);
	expect(await response.json()).toEqual({ success: false, code, message: expect.any(String), data: null });
}

describe("assembled Gateway response contract", () => {
	beforeEach(() => {
		spyOn(logger, "info").mockImplementation(() => {});
		spyOn(logger, "error").mockImplementation(() => {});
		spyOn(auth.api, "getSession").mockResolvedValue(session);
		spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ success: true, provider: "openai", model: "gpt-test" }), { headers: { "content-type": "application/json" } }));
		spyOn(health, "checkDatabase").mockResolvedValue({ status: "ok", latencyMs: 1 });
		spyOn(health, "checkRedis").mockResolvedValue({ status: "ok", latencyMs: 1 });
		redis = new Redis({ lazyConnect: true });
		spyOn(taskService, "getRedis").mockReturnValue(redis);
		spyOn(redis, "hgetall").mockResolvedValue({ worker: JSON.stringify(worker), invalid: "bad JSON" });
		spyOn(redis, "hmget").mockResolvedValue(["贵州茅台"]);
		spyOn(redis, "quit").mockResolvedValue("OK");
		spyOn(ConfigService, "listByUser").mockResolvedValue([]);
		spyOn(ConfigService, "upsert").mockResolvedValue(undefined);
		spyOn(WatchlistService, "listByUser").mockResolvedValue([watchlist]);
		spyOn(WatchlistService, "create").mockResolvedValue(watchlist);
		spyOn(WatchlistService, "remove").mockResolvedValue(undefined);
		spyOn(TaskService, "listByUser").mockResolvedValue([task]);
		spyOn(TaskService, "createMiningTask").mockResolvedValue({ success: true, taskId: task.id });
		spyOn(TaskService, "listDataCollectionTasks").mockResolvedValue(collectionList);
		spyOn(TaskService, "getDataCollectionConfig").mockResolvedValue(config);
		spyOn(TaskService, "setDataCollectionConfig").mockResolvedValue({ success: true });
		spyOn(engineClient, "reloadConfig").mockResolvedValue(true);
		spyOn(TaskService, "runDataCollectionTask").mockResolvedValue({ success: true, taskId: task.id });
		spyOn(TaskService, "getTaskStatus").mockResolvedValue(task);
		spyOn(TaskService, "cancelTask").mockResolvedValue({ success: true, status: "CANCELLING" });
		spyOn(TaskService, "getFailedStocks").mockResolvedValue(failures);
		spyOn(TaskService, "retryFailedStocks").mockResolvedValue({ success: true, taskId: "task-2", stockCount: 1 });
		spyOn(TaskService, "getTaskLogs").mockResolvedValue({ logs: ["log"], nextOffset: 1 });
		spyOn(FactorService, "listByUser").mockResolvedValue({ data: [], total: 0 });
		spyOn(FactorService, "getSelectedFactors").mockResolvedValue(factorSet);
		spyOn(FactorService, "setSelectedFactors").mockResolvedValue({ success: true, mode: "AUTO" });
		spyOn(FactorSelectionService, "create").mockResolvedValue({ success: true, taskId: task.id });
		spyOn(FactorSelectionService, "list").mockResolvedValue({ data: [task], total: 1 });
		spyOn(FactorSelectionService, "detail").mockResolvedValue(factorDetail);
		spyOn(StrategyService, "recommendFactors").mockResolvedValue([]);
		spyOn(StrategyService, "simulateFactor").mockResolvedValue(simulation);
		spyOn(StrategyService, "generateReportStructured").mockResolvedValue({ summary: "report" });
		spyOn(LlmService, "listByUser").mockResolvedValue([model]);
		spyOn(LlmService, "create").mockResolvedValue(model);
		spyOn(LlmService, "update").mockResolvedValue(model);
		spyOn(LlmService, "delete").mockResolvedValue({ success: true });
		spyOn(LlmService, "setDefault").mockResolvedValue(model);
		spyOn(LlmStockSelectionService, "create").mockResolvedValue({ taskId: task.id });
		spyOn(LlmStockSelectionService, "list").mockResolvedValue(selectionList);
		spyOn(LlmStockSelectionService, "detail").mockResolvedValue(selectionTask);
		spyOn(LlmStockSelectionService, "results").mockResolvedValue(results);
		spyOn(LlmStockSelectionService, "stockDetail").mockResolvedValue(stockDetail);
		spyOn(LlmStockSelectionService, "cancel").mockResolvedValue({ success: true, status: "CANCELLING" });
		spyOn(LlmStockSelectionService, "retryFailed").mockResolvedValue({ taskId: task.id, retryCount: 1 });
		spyOn(MarketDataService, "search").mockResolvedValue([{ code: "sh.600519", name: "贵州茅台" }]);
		spyOn(MarketDataService, "getKline").mockResolvedValue(chart);
		app = createApp();
	});

	afterEach(async () => {
		await Bun.sleep(0);
		redis.disconnect();
		mock.restore();
	});

	it("covers every mounted business endpoint without mounting retired Analysis", () => {
		const actual = app.routes.filter((route) => route.path.startsWith("/api/") && !route.path.startsWith("/api/auth") && route.method !== "OPTIONS")
			.map((route) => `${route.method} ${route.path.replace(/\/$/, "")}`).sort();
		const tested = successCases.map(({ method, path }) => `${method} ${path.split("?")[0]
			.replace(/\/(task-1|model-1|watch-1)(?=\/|$)/g, "/:id").replace("/sh.600519", "/:symbol")}`).sort();
		expect(actual).toHaveLength(42);
		expect(tested).toEqual(actual);
	});

	it.each(successCases)("envelopes $method $path", async ({ method, path, body, data }) => {
		const response = await send(method, path, body);
		expect(response.status).toBe(200);
		expect(response.headers.get("x-request-id")).toBe("contract-test");
		expect(await response.json()).toEqual({ success: true, code: 0, message: expect.any(String), data: JSON.parse(JSON.stringify(data)) });
	});

	it.each(successCases)("authenticates $method $path with a typed failure", async ({ method, path, body }) => {
		spyOn(auth.api, "getSession").mockResolvedValue(null);
		await expectFailure(await send(method, path, body), 401, ApiCode.UNAUTHENTICATED);
	});

	it("normalizes parse, schema, unknown-route and unknown-service errors", async () => {
		await expectFailure(await send("GET", "/api/factors?limit=-1"), 400, ApiCode.VALIDATION_ERROR);
		await expectFailure(await send("POST", "/api/llm", {}), 400, ApiCode.VALIDATION_ERROR);
		const malformed = await app.handle(new Request("http://localhost/api/llm", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
		await expectFailure(malformed, 400, ApiCode.VALIDATION_ERROR);
		for (const path of ["/api/missing", "/api/tasks/task-1/missing", "/api/analysis"]) {
			await expectFailure(await send("GET", path), 404, ApiCode.NOT_FOUND);
		}
		spyOn(ConfigService, "listByUser").mockRejectedValue(new Error("private database password"));
		const response = await send("GET", "/api/config");
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ success: false, code: ApiCode.INTERNAL_ERROR, message: "服务器内部错误", data: null });
		expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ requestId: "contract-test", method: "GET", path: "/api/config" }), "request failed");
	});

	it("maps task absence on each detail, progress, logs and cancellation path", async () => {
		spyOn(TaskService, "getTaskStatus").mockResolvedValue(null);
		spyOn(TaskService, "getFailedStocks").mockResolvedValue(null);
		spyOn(TaskService, "getTaskLogs").mockResolvedValue(null);
		spyOn(TaskService, "cancelTask").mockResolvedValue({ success: false, code: "TASK_NOT_FOUND", error: "任务不存在" });
		for (const path of ["status", "progress", "failed-stocks", "logs?offset=0"]) {
			await expectFailure(await send("GET", `/api/tasks/task-1/${path}`), 404, ApiCode.TASK_NOT_FOUND);
		}
		await expectFailure(await send("POST", "/api/tasks/task-1/cancel"), 404, ApiCode.TASK_NOT_FOUND);
	});

	it("maps absent factor and LLM selection details without leaking task identity", async () => {
		spyOn(FactorSelectionService, "detail").mockResolvedValue(null);
		await expectFailure(await send("GET", "/api/factor-selections/task-1"), 404, ApiCode.FACTOR_SELECTION_NOT_FOUND);
		spyOn(LlmStockSelectionService, "detail").mockResolvedValue(null);
		spyOn(LlmStockSelectionService, "results").mockResolvedValue(null);
		spyOn(LlmStockSelectionService, "stockDetail").mockResolvedValue(null);
		spyOn(LlmStockSelectionService, "cancel").mockResolvedValue(null);
		for (const path of ["", "/results"]) {
			await expectFailure(await send("GET", `/api/llm-stock-selections/task-1${path}`), 404, ApiCode.TASK_NOT_FOUND);
		}
		await expectFailure(await send("GET", "/api/llm-stock-selections/task-1/results/sh.600519"), 404, ApiCode.NOT_FOUND);
		await expectFailure(await send("POST", "/api/llm-stock-selections/task-1/cancel"), 404, ApiCode.TASK_NOT_FOUND);
		spyOn(LlmStockSelectionService, "cancel").mockResolvedValue({ success: false, code: "TASK_NOT_FOUND", error: "任务不存在" });
		await expectFailure(await send("POST", "/api/llm-stock-selections/task-1/cancel"), 404, ApiCode.TASK_NOT_FOUND);
	});

	it("preserves command reason codes, HTTP distinctions and strict null failure data", async () => {
		for (const code of ["TASK_MODEL_REQUIRED", "TASK_MODEL_NOT_FOUND", "QUEUE_UNAVAILABLE"] as const) {
			spyOn(TaskService, "createMiningTask").mockResolvedValue({ success: false, code, error: "无法启动", taskId: "private-task" });
			await expectFailure(await send("POST", "/api/tasks/mining", { researchDirection: "量价关系" }), 400, ApiCode[code]);
		}
		for (const conflict of [true, false]) {
			const code = conflict ? "ACTIVE_TASK" : "QUEUE_UNAVAILABLE";
			spyOn(TaskService, "runDataCollectionTask").mockResolvedValue({ success: false, code, error: "无法启动", conflict, taskId: "private-task" });
			await expectFailure(await send("POST", "/api/tasks/data-collection/run"), conflict ? 409 : 503, ApiCode[code]);
		}
		for (const code of ["TASK_NOT_RETRYABLE", "NO_FAILED_STOCKS", "ACTIVE_TASK", "QUEUE_UNAVAILABLE"] as const) {
			spyOn(TaskService, "retryFailedStocks").mockResolvedValue({ success: false, code, error: "无法重试", conflict: code === "ACTIVE_TASK", taskId: "private-task" });
			await expectFailure(await send("POST", "/api/tasks/task-1/retry-failed"), code === "ACTIVE_TASK" ? 409 : 400, ApiCode[code]);
		}
		for (const code of ["FACTOR_IDS_DUPLICATED", "FACTOR_IDS_INVALID"] as const) {
			spyOn(FactorService, "setSelectedFactors").mockResolvedValue({ success: false, code, error: "无效因子" });
			await expectFailure(await send("PUT", "/api/factors/selection", { factorIds: [] }), 400, ApiCode[code]);
		}
		for (const code of ["FACTOR_SET_EMPTY", "WATCHLIST_EMPTY", "QUEUE_UNAVAILABLE"] as const) {
			spyOn(FactorSelectionService, "create").mockResolvedValue({ success: false, code, error: "无法选股", taskId: "private-task" });
			await expectFailure(await send("POST", "/api/factor-selections", factorSelectionInput), 400, ApiCode[code]);
		}
	});

	it("rolls back scheduler configuration on persistence failure", async () => {
		spyOn(engineClient, "reloadConfig").mockResolvedValue(false);
		await expectFailure(await send("PUT", "/api/tasks/data-collection/config", config), 400, ApiCode.CONFIG_RELOAD_FAILED);
		expect(TaskService.setDataCollectionConfig).not.toHaveBeenCalled();
		const reload = spyOn(engineClient, "reloadConfig").mockResolvedValue(true);
		spyOn(TaskService, "setDataCollectionConfig").mockRejectedValue(new Error("private write failure"));
		await expectFailure(await send("PUT", "/api/tasks/data-collection/config", { ...config, cronExpression: "30 20 * * mon-fri" }), 500, ApiCode.INTERNAL_ERROR);
		expect(reload).toHaveBeenLastCalledWith(config.cronExpression);
	});

	it.each([
		{ code: "ACTIVE_TASK", status: 409 }, { code: "MODEL_NOT_FOUND", status: 404 },
		{ code: "FACTOR_SET_EMPTY", status: 400 }, { code: "TASK_NOT_FOUND", status: 404 },
		{ code: "TASK_NOT_RETRYABLE", status: 409 }, { code: "NO_FAILED_CANDIDATES", status: 400 },
		{ code: "INVALID_RETRY_SYMBOLS", status: 400 }, { code: "QUEUE_UNAVAILABLE", status: 503 },
	] as const)("maps LLM selection $code without the former error-side taskId", async ({ code, status }) => {
		const error = new LlmStockSelectionServiceError(code, "操作失败", status, "private-task");
		spyOn(LlmStockSelectionService, "create").mockRejectedValue(error);
		spyOn(LlmStockSelectionService, "retryFailed").mockRejectedValue(error);
		await expectFailure(await send("POST", "/api/llm-stock-selections", selectionInput), status, ApiCode[code]);
		await expectFailure(await send("POST", "/api/llm-stock-selections/task-1/retry-failed", {}), status, ApiCode[code]);
	});

	it.each([
		{ status: 401, body: { detail: "Invalid service token" }, expected: 502, code: ApiCode.UPSTREAM_AUTH_ERROR },
		{ status: 422, body: { code: "LLM_CONFIG_INVALID", message: "private config" }, expected: 422, code: ApiCode.LLM_CONFIG_INVALID },
		{ status: 504, body: { code: "LLM_TIMEOUT", message: "private provider" }, expected: 504, code: ApiCode.LLM_TIMEOUT },
		{ status: 503, body: { detail: "private traceback" }, expected: 503, code: ApiCode.LLM_PROVIDER_UNAVAILABLE },
	])("converts Engine HTTP $status only at the public boundary", async ({ status, body, expected, code }) => {
		spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
		await expectFailure(await send("POST", "/api/llm/model-1/test"), expected, code);
	});

	it("sanitizes non-JSON upstream responses", async () => {
		spyOn(globalThis, "fetch").mockImplementation(async () => new Response("<html>private proxy details</html>", { status: 502 }));
		await expectFailure(await send("POST", "/api/llm/model-1/test"), 502, ApiCode.LLM_PROVIDER_UNAVAILABLE);
	});

	it("does not turn an Engine HTTP-200 simulation error into public success", async () => {
		const builder = db.select();
		const query = builder.from(alphaFactors);
		spyOn(query, "execute").mockResolvedValue([{ id: "factor-1", expression: "close" }]);
		spyOn(builder, "from").mockReturnValue(query);
		spyOn(db, "select").mockReturnValue(builder);
		spyOn(StrategyService, "simulateFactor").mockImplementation(simulateFactor);
		spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ status: "error", message: "private simulation failure" }), { headers: { "content-type": "application/json" } }));
		await expectFailure(await send("POST", "/api/strategy/simulate", { factorId: "factor-1" }), 502, ApiCode.UPSTREAM_ERROR);
	});

	it.each([
		{ code: "MARKET_DATA_INVALID", status: 502 }, { code: "STOCK_UNIVERSE_INVALID", status: 502 },
		{ code: "STOCK_UNIVERSE_EMPTY", status: 404 }, { code: "MARKET_DATA_UNAVAILABLE", status: 503 },
		{ code: "INVALID_SYMBOL", status: 400 }, { code: "SYMBOL_NOT_FOUND", status: 404 },
		{ code: "KLINE_NOT_FOUND", status: 404 }, { code: "KLINE_EMPTY", status: 404 },
	] as const)("maps market-data domain reason $code", async ({ code, status }) => {
		spyOn(MarketDataService, "getKline").mockRejectedValue(new MarketDataError(code, "暂无行情", status));
		await expectFailure(await send("GET", "/api/market-data/sh.600519/kline"), status, ApiCode[code]);
	});

	it("preserves LLM domain validation, not-found and referenced-model conflicts", async () => {
		spyOn(LlmService, "create").mockRejectedValue(new LlmValidationError("配置无效"));
		await expectFailure(await send("POST", "/api/llm", createModelInput), 422, ApiCode.LLM_CONFIG_INVALID);
		spyOn(LlmService, "delete").mockRejectedValue(new LlmServiceError("LLM_CONFIG_REFERENCED", "模型仍被引用", 409));
		await expectFailure(await send("DELETE", "/api/llm/model-1"), 409, ApiCode.LLM_CONFIG_REFERENCED);
		spyOn(LlmService, "setDefault").mockRejectedValue(new LlmServiceError("LLM_CONFIG_NOT_FOUND", "模型不存在", 404));
		await expectFailure(await send("POST", "/api/llm/model-1/default"), 404, ApiCode.LLM_CONFIG_NOT_FOUND);
	});

	it("keeps Better Auth bodies, health readiness, root text and native streams separate", async () => {
		for (const path of ["/api/auth/ok", "/api/auth/get-session"]) {
			const direct = await auth.handler(new Request(`http://localhost${path}`));
			const response = await send("GET", path);
			expect(response.status).toBe(direct.status);
			expect(await response.json()).toEqual(await direct.json());
		}
		const invalidSignIn = new Request("http://localhost/api/auth/sign-in/email", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "invalid-email", password: "unused-test-value" }),
		});
		const directAuthError = await auth.handler(invalidSignIn.clone());
		const routedAuthError = await app.handle(invalidSignIn);
		expect(routedAuthError.status).toBe(directAuthError.status);
		expect(await routedAuthError.json()).toEqual(await directAuthError.json());
		expect(await (await send("GET", "/health/live")).json()).toEqual({ status: "ok" });
		spyOn(health, "checkDatabase").mockResolvedValue({ status: "error", latencyMs: 1, error: "private password" });
		const readiness = await send("GET", "/health");
		expect(readiness.status).toBe(503);
		expect(await readiness.json()).toEqual({ status: "error", dependencies: { database: { status: "error", latencyMs: 1 }, redis: { status: "ok", latencyMs: 1 } } });
		expect(await (await send("GET", "/")).text()).toBe("Stock Quant System API Gateway is running");
		const native = createApp().get("/stream", () => new Response("data: event\n\n", { headers: { "content-type": "text/event-stream" } }));
		const stream = await native.handle(new Request("http://localhost/stream"));
		expect(stream.headers.get("content-type")).toBe("text/event-stream");
		expect(await stream.text()).toBe("data: event\n\n");
	});
});
