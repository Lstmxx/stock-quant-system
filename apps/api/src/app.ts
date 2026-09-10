import "./lib/env";

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { checkDatabase, checkRedis, toPublicHealth } from "./lib/health";
import { logger } from "./lib/logger";
import { configModule } from "./modules/config";
import { watchlistModule } from "./modules/watchlist";
import { taskModule } from "./modules/task";
import { factorModule } from "./modules/factor";
import { factorSelectionModule } from "./modules/factor-selection";
import { strategyModule } from "./modules/strategy";
import { llmModule } from "./modules/llm";
import { llmStockSelectionModule } from "./modules/llm-stock-selection";
import { marketDataModule } from "./modules/market-data";
import { apiErrors } from "./plugins/api-errors";
import { auth, betterAuthPlugin } from "./plugins/auth";

export function createApp() {
	return new Elysia()
		.onRequest(({ request, set }) => {
			const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
			set.headers["x-request-id"] = requestId;
		})
		.onAfterResponse(({ request, set }) => {
			logger.info({
				requestId: set.headers["x-request-id"] ?? request.headers.get("x-request-id"),
				method: request.method,
				path: new URL(request.url).pathname,
				status: set.status,
			}, "request completed");
		})
		.use(apiErrors)
		.use(cors({
			origin: process.env.CORS_ORIGIN || "http://localhost:5173",
			credentials: true,
			allowedHeaders: ["Content-Type", "Authorization"],
		}))
		.get("/health/live", () => ({ status: "ok" }))
		.get("/health", async ({ set }) => {
			const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
			const healthy = database.status === "ok" && redis.status === "ok";
			if (!healthy) set.status = 503;
			return {
				status: healthy ? "ok" : "error",
				dependencies: {
					database: toPublicHealth(database),
					redis: toPublicHealth(redis),
				},
			};
		})
		.use(betterAuthPlugin)
		.all("/api/auth", ({ request }) => auth.handler(request), { parse: "none" })
		.all("/api/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
		.group("/api", (app) => app
			.use(configModule)
			.use(watchlistModule)
			.use(taskModule)
			.use(factorModule)
			.use(factorSelectionModule)
			.use(strategyModule)
			.use(llmModule)
			.use(llmStockSelectionModule)
			.use(marketDataModule))
		.get("/", () => "Stock Quant System API Gateway is running");
}

export type App = ReturnType<typeof createApp>;
