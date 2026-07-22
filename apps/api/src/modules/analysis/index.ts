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
			async ({ user, params, status, request }) => {
			const task = await AnalysisService.getById(user.id, params.id);
			if (!task) return status(404);

				return new Stream(async (stream) => {
					const redis = getRedis();
					const channel = `task_log:${params.id}`;
					let closed = false;
					let interval: ReturnType<typeof setInterval> | undefined;
					const cleanup = async () => {
						if (closed) return;
						closed = true;
						if (interval) clearInterval(interval);
						request.signal.removeEventListener("abort", handleAbort);
						await redis.unsubscribe(channel).catch(() => undefined);
						redis.removeAllListeners("message");
						await redis.quit().catch(() => undefined);
					};
					const handleAbort = () => {
						void cleanup();
					};
					request.signal.addEventListener("abort", handleAbort, { once: true });

					try {
						await redis.subscribe(channel);

						stream.send(
							JSON.stringify({ type: "connected", taskId: params.id }),
						);

						redis.on("message", (ch, message) => {
							if (ch === channel && !closed) stream.send(message);
						});

						interval = setInterval(() => {
							try {
								if (!closed) stream.send(JSON.stringify({ type: "ping" }));
							} catch {
								void cleanup();
							}
						}, 5000);
					} catch (error) {
						await cleanup();
						throw error;
					}
				});
		},
		{ auth: true },
	);
