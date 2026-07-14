import { Elysia, t } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import { TaskService, getRedis } from "./service";
import { CreateMiningTaskBody } from "./model";

export const taskModule = new Elysia({ prefix: "/tasks", name: "task" })
	.use(betterAuthPlugin)
	.get("/", ({ user }) => TaskService.listByUser(user.id), {
		auth: true,
	})
	.post("/mining", async ({ user, body, set }) => {
		const res = await TaskService.createMiningTask(user.id, body);
		if (!res.success) {
			set.status = 400;
			return res;
		}
		return res;
	}, {
		auth: true,
		body: CreateMiningTaskBody,
	})
	.get("/data-collection/config", ({ user }) => TaskService.getDataCollectionConfig(user.id), {
		auth: true,
	})
	.put("/data-collection/config", ({ user, body }) => TaskService.setDataCollectionConfig(user.id, body.lookbackDays, body.workerCount), {
		auth: true,
		body: t.Object({ lookbackDays: t.Number(), workerCount: t.Number() })
	})
	.post("/data-collection/run", ({ user }) => TaskService.runDataCollectionTask(user.id), {
		auth: true,
	})
	// Returns full code->name mapping from Redis (populated during data collection)
	.get("/data-collection/stock-names", async ({ query }) => {
		const redis = getRedis();
		const { codes } = query;
		let names: Record<string, string>;
		if (codes) {
			// Selective lookup: ?codes=sh.600036,sz.000001
			const codeList = codes.split(",").map((c: string) => c.trim()).filter(Boolean);
			const values = await redis.hmget("stock_names", ...codeList);
			names = Object.fromEntries(codeList.map((c: string, i: number) => [c, values[i] ?? ""]));
		} else {
			const raw = await redis.hgetall("stock_names");
			names = raw || {};
		}
		await redis.quit();
		return names;
	}, {
		auth: true,
		query: t.Object({ codes: t.Optional(t.String()) }),
	})
	.get("/:id/status", async ({ user, params, set }) => {
		const task = await TaskService.getTaskStatus(user.id, params.id);
		if (!task) { set.status = 404; return "Not Found"; }
		return task;
	}, {
		auth: true,
	})
	.post("/:id/cancel", async ({ user, params, set }) => {
		const res = await TaskService.cancelTask(user.id, params.id);
		if (!res.success) { set.status = 404; return res; }
		return res;
	}, {
		auth: true,
	})
	// Polling endpoint: returns current per-worker progress snapshot from Redis
	.get("/:id/progress", async ({ user, params, set }) => {
		const task = await TaskService.getTaskStatus(user.id, params.id);
		if (!task) { set.status = 404; return "Not Found"; }

		const redis = getRedis();
		const raw = await redis.hgetall(`task_progress:${params.id}`);
		await redis.quit();

		const workers = Object.values(raw || {}).map(v => JSON.parse(v));
		return { taskId: params.id, status: task.status, workers };
	}, {
		auth: true,
	})
	// Get list of failed stocks for a completed task
	.get("/:id/failed-stocks", async ({ user, params, set }) => {
		const result = await TaskService.getFailedStocks(user.id, params.id);
		if (!result) { set.status = 404; return "Not Found"; }
		return result;
	}, {
		auth: true,
	})
	// Retry all failed stocks from a given task
	.post("/:id/retry-failed", async ({ user, params, set }) => {
		const result = await TaskService.retryFailedStocks(user.id, params.id);
		if (!result.success) { set.status = 400; return result; }
		return result;
	}, {
		auth: true,
	})
	// Polling endpoint for logs
	.get("/:id/logs", async ({ user, params, query, set }) => {
		const result = await TaskService.getTaskLogs(user.id, params.id, query.offset);
		if (!result) { set.status = 404; return "Not Found"; }
		return result;
	}, {
		auth: true,
		query: t.Object({ offset: t.Numeric() }),
	});
