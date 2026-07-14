import { Elysia, t } from "elysia";
import { engineClient } from "../../lib/engine-client";
import { betterAuthPlugin } from "../../plugins/auth";
import {
	CreateMiningTaskBody,
	DataCollectionConfigBody,
	DataCollectionListQuery,
} from "./model";
import { getRedis, TaskService } from "./service";

export const taskModule = new Elysia({ prefix: "/tasks", name: "task" })
	.use(betterAuthPlugin)
	.get("/", ({ user }) => TaskService.listByUser(user.id), { auth: true })
	.post(
		"/mining",
		async ({ user, body, set }) => {
			const result = await TaskService.createMiningTask(user.id, body);
			if (!result.success) set.status = 400;
			return result;
		},
		{ auth: true, body: CreateMiningTaskBody },
	)
	.get(
		"/data-collection",
		({ query }) =>
			TaskService.listDataCollectionTasks(query.limit ?? 50, query.offset ?? 0),
		{ auth: true, query: DataCollectionListQuery },
	)
	.get(
		"/data-collection/config",
		() => TaskService.getDataCollectionConfig(),
		{ auth: true },
	)
	.put(
		"/data-collection/config",
		async ({ user, body, set }) => {
			const previous = await TaskService.getDataCollectionConfig();
			const reloaded = await engineClient.reloadConfig(body.cronExpression);
			if (!reloaded) {
				set.status = 400;
				return { success: false, error: "定时表达式无效或 Engine 不可用" };
			}

			try {
				return await TaskService.setDataCollectionConfig(
					user.id,
					body.lookbackDays,
					body.workerCount,
					body.cronExpression,
				);
			} catch (error) {
				await engineClient.reloadConfig(previous.cronExpression);
				throw error;
			}
		},
		{ auth: true, body: DataCollectionConfigBody },
	)
	.post(
		"/data-collection/run",
		async ({ user, set }) => {
			const result = await TaskService.runDataCollectionTask(user.id);
			if (!result.success) set.status = result.conflict ? 409 : 503;
			return result;
		},
		{ auth: true },
	)
	.get(
		"/data-collection/stock-names",
		async ({ query }) => {
			const redis = getRedis();
			try {
				const { codes } = query;
				if (!codes) return (await redis.hgetall("stock_names")) || {};

				const codeList = codes
					.split(",")
					.map((code) => code.trim())
					.filter(Boolean)
					.slice(0, 500);
				const values = await redis.hmget("stock_names", ...codeList);
				return Object.fromEntries(
					codeList.map((code, index) => [code, values[index] ?? ""]),
				);
			} finally {
				await redis.quit().catch(() => undefined);
			}
		},
		{
			auth: true,
			query: t.Object({ codes: t.Optional(t.String({ maxLength: 10000 })) }),
		},
	)
	.get(
		"/:id/status",
		async ({ user, params, set }) => {
			const task = await TaskService.getTaskStatus(user.id, params.id);
			if (!task) {
				set.status = 404;
				return { error: "Not Found" };
			}
			return task;
		},
		{ auth: true },
	)
	.post(
		"/:id/cancel",
		async ({ user, params, set }) => {
			const result = await TaskService.cancelTask(user.id, params.id);
			if (!result.success) set.status = 404;
			return result;
		},
		{ auth: true },
	)
	.get(
		"/:id/progress",
		async ({ user, params, set }) => {
			const task = await TaskService.getTaskStatus(user.id, params.id);
			if (!task) {
				set.status = 404;
				return { error: "Not Found" };
			}

			const redis = getRedis();
			try {
				const raw = await redis.hgetall(`task_progress:${params.id}`);
				const workers = Object.values(raw || {}).flatMap((value) => {
					try {
						const parsed: unknown = JSON.parse(value);
						return parsed && typeof parsed === "object" ? [parsed] : [];
					} catch {
						return [];
					}
				});
				return { taskId: params.id, status: task.status, workers };
			} finally {
				await redis.quit().catch(() => undefined);
			}
		},
		{ auth: true },
	)
	.get(
		"/:id/failed-stocks",
		async ({ user, params, set }) => {
			const result = await TaskService.getFailedStocks(user.id, params.id);
			if (!result) {
				set.status = 404;
				return { error: "Not Found" };
			}
			return result;
		},
		{ auth: true },
	)
	.post(
		"/:id/retry-failed",
		async ({ user, params, set }) => {
			const result = await TaskService.retryFailedStocks(user.id, params.id);
			if (!result.success) {
				set.status = "conflict" in result && result.conflict ? 409 : 400;
			}
			return result;
		},
		{ auth: true },
	)
	.get(
		"/:id/logs",
		async ({ user, params, query, set }) => {
			const result = await TaskService.getTaskLogs(
				user.id,
				params.id,
				query.offset,
			);
			if (!result) {
				set.status = 404;
				return { error: "Not Found" };
			}
			return result;
		},
		{
			auth: true,
			query: t.Object({ offset: t.Numeric({ minimum: 0 }) }),
		},
	);
