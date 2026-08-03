import { logger } from "./logger";

export function runBackgroundTask(name: string, task: () => Promise<void>) {
	void task().catch((error) => {
		logger.error({ task: name, error }, "background task failed");
	});
}
