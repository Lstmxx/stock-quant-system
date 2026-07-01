import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { betterAuthPlugin } from "./plugins/auth";
import { configModule } from "./modules/config";
import { watchlistModule } from "./modules/watchlist";
import { taskModule } from "./modules/task";
import { factorModule } from "./modules/factor";
import { analysisModule } from "./modules/analysis";

const app = new Elysia()
	.use(
		cors({
			origin: process.env.CORS_ORIGIN || "http://localhost:5173",
			credentials: true,
			allowedHeaders: ["Content-Type", "Authorization"],
		}),
	)
	.use(betterAuthPlugin)
	.use(configModule)
	.use(watchlistModule)
	.use(taskModule)
	.use(factorModule)
	.use(analysisModule)
	.get("/", () => "Stock Quant System API Gateway is running")
	.listen(3000);

export type App = typeof app;

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
