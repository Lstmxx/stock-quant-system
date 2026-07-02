import { config } from "dotenv";
config({ path: "../../.env" });

import { Elysia } from "elysia";
import { db, userConfigs } from "@stock-quant/database";
import { eq } from "drizzle-orm";
import { engineClient } from "./lib/engine-client";
import { cors } from "@elysiajs/cors";
import { betterAuthPlugin } from "./plugins/auth";
import { configModule } from "./modules/config";
import { watchlistModule } from "./modules/watchlist";
import { taskModule } from "./modules/task";
import { factorModule } from "./modules/factor";
import { analysisModule } from "./modules/analysis";
import { strategyModule } from "./modules/strategy";

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
			.use(analysisModule)
			.use(strategyModule)
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
		const configs = await db
			.select()
			.from(userConfigs)
			.where(eq(userConfigs.key, "BAOSTOCK_CRON"));
		if (configs.length > 0) {
			console.log(`[API] Pushing BAOSTOCK_CRON to Engine on startup: ${configs[0].value}`);
			await engineClient.reloadConfig(configs[0].value);
		}
	} catch (e) {
		console.error("[API] Failed to push config to engine on startup", e);
	}
}, 2000);
