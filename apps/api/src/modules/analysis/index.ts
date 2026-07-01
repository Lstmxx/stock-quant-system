import { Elysia } from "elysia";
import { Stream } from "@elysiajs/stream";
import { betterAuthPlugin } from "../../plugins/auth";
import { AnalysisService } from "./service";
import { StartAnalysisBody } from "./model";
import { getRedis } from "../task/service";

export const analysisModule = new Elysia({ prefix: "/analysis", name: "analysis" })
	.use(betterAuthPlugin)

	// Start a new LLM stock analysis task
	.post(
		"/start",
		async ({ user, body }) => {
			return AnalysisService.startAnalysis(user.id, body);
		},
		{
			auth: true,
			body: StartAnalysisBody,
		},
	)

	// List all analysis tasks for the user
	.get(
		"/",
		({ user }) => AnalysisService.listByUser(user.id),
		{ auth: true },
	)

	// Get a single analysis result (for polling or initial load)
	.get(
		"/:id",
		async ({ user, params, status }) => {
			const task = await AnalysisService.getById(user.id, params.id);
			if (!task) return status(404);
			return task;
		},
		{ auth: true },
	)

	// SSE stream for real-time task status updates
	.get(
		"/:id/stream",
		async ({ user, params, status }) => {
			const task = await AnalysisService.getById(user.id, params.id);
			if (!task) return status(404);

			return new Stream(async (stream) => {
				const redis = getRedis();
				const channel = `task_log:${params.id}`;

				await redis.subscribe(channel);

				stream.send(
					JSON.stringify({ type: "connected", taskId: params.id }),
				);

				redis.on("message", (ch, message) => {
					if (ch === channel) {
						stream.send(message);
					}
				});

				// Keepalive ping every 5s
				const interval = setInterval(() => {
					try {
						stream.send(JSON.stringify({ type: "ping" }));
					} catch {
						clearInterval(interval);
						redis.quit();
					}
				}, 5000);
			});
		},
		{ auth: true },
	);
