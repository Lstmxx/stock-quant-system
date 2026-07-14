import { config } from "dotenv";
config({ path: "../../.env" });

import { Elysia } from "elysia";
import { engineClient } from "./lib/engine-client";
import { cors } from "@elysiajs/cors";
import { betterAuthPlugin } from "./plugins/auth";
import { configModule } from "./modules/config";
import { watchlistModule } from "./modules/watchlist";
import { taskModule } from "./modules/task";
import { factorModule } from "./modules/factor";
import { factorSelectionModule } from "./modules/factor-selection";
import { analysisModule } from "./modules/analysis";
import { strategyModule } from "./modules/strategy";
import { llmModule } from "./modules/llm";
import { TaskService } from "./modules/task/service";

const app = new Elysia()
	.use(
		cors({
			origin: process.env.CORS_ORIGIN || "http://localhost:5173",
			credentials: true,
			allowedHeaders: ["Content-Type", "Authorization"],
		}),
	)
	.use(betterAuthPlugin)
	.group("/api", (app) =>
		app
			.use(configModule)
			.use(watchlistModule)
			.use(taskModule)
			.use(factorModule)
			.use(factorSelectionModule)
			.use(analysisModule)
			.use(strategyModule)
			.use(llmModule)
	)
	.get("/", () => "Stock Quant System API Gateway is running")
	.listen(process.env.PORT_API || 3000);

export type App = typeof app;

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);

// Push the cron config to Engine on startup
setTimeout(async () => {
	try {
		const collectionConfig = await TaskService.getDataCollectionConfig();
		console.log(
			`[API] Pushing global data collection cron to Engine: ${collectionConfig.cronExpression}`,
		);
		await engineClient.reloadConfig(collectionConfig.cronExpression);
	} catch (e) {
		console.error("[API] Failed to push config to engine on startup", e);
	}
}, 2000);
