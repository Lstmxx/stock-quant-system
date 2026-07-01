import { Elysia } from "elysia";
import { Stream } from "@elysiajs/stream";
import { betterAuthPlugin } from "../../plugins/auth";
import { TaskService, getRedis } from "./service";
import { CreateTaskBody } from "./model";

export const taskModule = new Elysia({ prefix: "/tasks", name: "task" })
	.use(betterAuthPlugin)
	.get("/", ({ user }) => TaskService.listByUser(user.id), {
		auth: true,
	})
	.post("/mining", ({ user, body }) => TaskService.createMiningTask(user.id, body), {
		auth: true,
		body: CreateTaskBody,
	})
	.get("/:id/status", async ({ user, params, status }) => {
		const task = await TaskService.getTaskStatus(user.id, params.id);
		if (!task) return status(404);
		return task;
	}, {
		auth: true,
	})
	.get("/:id/stream", async ({ user, params, status }) => {
		// Verify user owns task
		const task = await TaskService.getTaskStatus(user.id, params.id);
		if (!task) return status(404);

		return new Stream(async (stream) => {
			const redis = getRedis();
			const channel = `task_log:${params.id}`;
			
			// Start listening
			await redis.subscribe(channel);
			
			stream.send(JSON.stringify({ type: "connected", message: `Subscribed to task ${params.id}` }));

			redis.on("message", (ch, message) => {
				if (ch === channel) {
					stream.send(message);
				}
			});

			// If client disconnects, stream is closed but we need to quit redis connection.
			// Elysia stream doesn't easily expose onClose inside the handler, but we can catch errors or wait for GC?
			// Actually Elysia Stream exposes .close event? Let's just keep the connection open for now and timeout, 
			// or better we check for stream.send throwing error.
			
			// We can poll every 5 seconds to send a ping to check if still connected
			const interval = setInterval(() => {
				try {
					stream.send(JSON.stringify({ type: "ping" }));
				} catch (e) {
					clearInterval(interval);
					redis.quit();
				}
			}, 5000);
		});
	}, {
		auth: true,
	});
