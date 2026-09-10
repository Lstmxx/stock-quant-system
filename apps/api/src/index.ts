import "./lib/env";

import { createApp } from "./app";
import { engineClient } from "./lib/engine-client";
import { TaskService } from "./modules/task/service";
import { runBackgroundTask } from "./lib/background";
import { logger } from "./lib/logger";
import { closeDatabase } from "@stock-quant/database";

const app = createApp().listen(process.env.PORT_API || 3000);

export type { App } from "./app";

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
