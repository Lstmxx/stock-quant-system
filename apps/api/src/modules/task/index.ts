import { Elysia } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import { TaskService } from "./service";
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
	});
