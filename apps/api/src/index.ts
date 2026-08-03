import "./lib/env";

import { Elysia } from "elysia";
import { engineClient } from "./lib/engine-client";
import { cors } from "@elysiajs/cors";
import { betterAuthPlugin } from "./plugins/auth";
import { configModule } from "./modules/config";
import { watchlistModule } from "./modules/watchlist";
import { taskModule } from "./modules/task";
import { factorModule } from "./modules/factor";
import { factorSelectionModule } from "./modules/factor-selection";
import { strategyModule } from "./modules/strategy";
import { llmModule } from "./modules/llm";
import { llmStockSelectionModule } from "./modules/llm-stock-selection";
import { TaskService } from "./modules/task/service";
import { runBackgroundTask } from "./lib/background";
import { checkDatabase, checkRedis, toPublicHealth } from "./lib/health";
import { logger } from "./lib/logger";
import { closeDatabase } from "@stock-quant/database";

const app = new Elysia()
	.onRequest(({ request, set }) => {
		const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
		set.headers["x-request-id"] = requestId;
	})
	.onAfterResponse(({ request, set }) => {
		logger.info(
			{
				requestId: set.headers["x-request-id"] ?? request.headers.get("x-request-id"),
				method: request.method,
				path: new URL(request.url).pathname,
				status: set.status,
			},
			"request completed",
		);
	})
	.onError(({ code, error, request, set }) => {
		logger.error(
			{
				requestId: set.headers["x-request-id"] ?? request.headers.get("x-request-id"),
				method: request.method,
				path: new URL(request.url).pathname,
				code,
				error,
			},
			"request failed",
		);

		if (code === "VALIDATION" || code === "PARSE") {
			set.status = 400;
			return { success: false, code, message: "请求参数无效" };
		}

		if (code === "NOT_FOUND") {
			set.status = 404;
			return { success: false, code, message: "资源不存在" };
		}

		set.status = 500;
		return { success: false, code: "INTERNAL_ERROR", message: "服务器内部错误" };
	})
	.use(
		cors({
			origin: process.env.CORS_ORIGIN || "http://localhost:5173",
			credentials: true,
			allowedHeaders: ["Content-Type", "Authorization"],
		}),
	)
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
	.group("/api", (app) =>
		app
			.use(configModule)
			.use(watchlistModule)
			.use(taskModule)
			.use(factorModule)
			.use(factorSelectionModule)
			.use(strategyModule)
			.use(llmModule)
			.use(llmStockSelectionModule)
	)
	.get("/", () => "Stock Quant System API Gateway is running")
	.listen(process.env.PORT_API || 3000);

export type App = typeof app;

logger.info(
	{ hostname: app.server?.hostname, port: app.server?.port },
	"Elysia server started",
);

let shuttingDown = false;
const shutdown = async (reason: string, exitCode = 0) => {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info({ reason }, "shutting down API");
	try {
		await app.stop();
		await closeDatabase();
	} catch (error) {
		logger.error({ error }, "failed during API shutdown");
		exitCode = 1;
	} finally {
		process.exit(exitCode);
	}
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (error) => {
	logger.fatal({ error }, "unhandled promise rejection");
		void shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
	logger.fatal({ error }, "uncaught exception");
	void shutdown("uncaughtException", 1);
});

// Push the cron config to Engine on startup

setTimeout(() => {
	runBackgroundTask("startup-sync", async () => {
		const interrupted = await TaskService.failInterruptedAnalysisTasks();
		if (interrupted > 0) {
			logger.warn({ interrupted }, "marked interrupted analysis tasks as failed");
		}
		const collectionConfig = await TaskService.getDataCollectionConfig();
		logger.info(
			{ cronExpression: collectionConfig.cronExpression },
			"pushing global data collection cron to Engine",
		);
		await engineClient.reloadConfig(collectionConfig.cronExpression);
	});
}, 2000);
