import { Elysia, t } from "elysia";
import { apiFailure, apiSuccess } from "../../lib/api-response";
import { engineClient } from "../../lib/engine-client";
import { betterAuthPlugin } from "../../plugins/auth";
import {
	CreateMiningTaskBody,
	DataCollectionConfigBody,
	DataCollectionListQuery,
	parseWorkerProgress,
} from "./model";
import { getRedis, TaskService } from "./service";

export const taskModule = new Elysia({ prefix: "/tasks", name: "task" })
	.use(betterAuthPlugin)
	.get("/", async ({ user }) => apiSuccess(await TaskService.listByUser(user.id)), { auth: true })
	.post(
		"/mining",
		async ({ user, body }) => {
			const result = await TaskService.createMiningTask(user.id, body);
			if (!result.success) return apiFailure(400, result.code, result.error);
			return apiSuccess({ taskId: result.taskId });
		},
		{ auth: true, body: CreateMiningTaskBody },
	)
	.get(
		"/data-collection",
		async ({ query }) =>
			apiSuccess(await TaskService.listDataCollectionTasks(query.limit ?? 50, query.offset ?? 0)),
		{ auth: true, query: DataCollectionListQuery },
	)
	.get(
		"/data-collection/config",
		async () => apiSuccess(await TaskService.getDataCollectionConfig()),
		{ auth: true },
	)
	.put(
		"/data-collection/config",
		async ({ user, body }) => {
			const previous = await TaskService.getDataCollectionConfig();
			const reloaded = await engineClient.reloadConfig(body.cronExpression);
			if (!reloaded) {
				return apiFailure(400, "CONFIG_RELOAD_FAILED", "定时表达式无效或 Engine 不可用");
			}

			try {
				await TaskService.setDataCollectionConfig(
					user.id,
					body.lookbackDays,
					body.workerCount,
					body.cronExpression,
				);
				return apiSuccess(null);
			} catch (error) {
				await engineClient.reloadConfig(previous.cronExpression);
				throw error;
			}
		},
		{ auth: true, body: DataCollectionConfigBody },
	)
	.post(
		"/data-collection/run",
		async ({ user }) => {
			const result = await TaskService.runDataCollectionTask(user.id);
			if (!result.success) return apiFailure(result.conflict ? 409 : 503, result.code, result.error);
			return apiSuccess({ taskId: result.taskId });
		},
		{ auth: true },
	)
	.get(
		"/data-collection/stock-names",
		async ({ query }) => {
			const redis = getRedis();
			try {
				const { codes } = query;
				if (!codes) return apiSuccess((await redis.hgetall("stock_names")) || {});

				const codeList = codes
					.split(",")
					.map((code) => code.trim())
					.filter(Boolean)
					.slice(0, 500);
				const values = await redis.hmget("stock_names", ...codeList);
				return apiSuccess(Object.fromEntries(
					codeList.map((code, index) => [code, values[index] ?? ""]),
				));
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
		async ({ user, params }) => {
			const task = await TaskService.getTaskStatus(user.id, params.id);
			if (!task) {
				return apiFailure(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
			}
			return apiSuccess(task);
		},
		{ auth: true },
	)
	.post(
		"/:id/cancel",
		async ({ user, params }) => {
			const result = await TaskService.cancelTask(user.id, params.id);
			if (!result.success) return apiFailure(404, result.code, result.error);
			return apiSuccess({ status: result.status });
		},
		{ auth: true },
	)
	.get(
		"/:id/progress",
		async ({ user, params }) => {
			const task = await TaskService.getTaskStatus(user.id, params.id);
			if (!task) {
				return apiFailure(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
			}

			const redis = getRedis();
			try {
				const raw = await redis.hgetall(`task_progress:${params.id}`);
				const workers = Object.values(raw || {}).flatMap((value) => {
					const worker = parseWorkerProgress(value);
					return worker ? [worker] : [];
				});
				return apiSuccess({ taskId: params.id, status: task.status, workers });
			} finally {
				await redis.quit().catch(() => undefined);
			}
		},
		{ auth: true },
	)
	.get(
		"/:id/failed-stocks",
		async ({ user, params }) => {
			const result = await TaskService.getFailedStocks(user.id, params.id);
			if (!result) {
				return apiFailure(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
			}
			return apiSuccess(result);
		},
		{ auth: true },
	)
	.post(
		"/:id/retry-failed",
		async ({ user, params }) => {
			const result = await TaskService.retryFailedStocks(user.id, params.id);
			if (!result.success) {
				return apiFailure("conflict" in result && result.conflict ? 409 : 400, result.code, result.error);
			}
			return apiSuccess({ taskId: result.taskId, stockCount: result.stockCount });
		},
		{ auth: true },
	)
	.get(
		"/:id/logs",
		async ({ user, params, query }) => {
			const result = await TaskService.getTaskLogs(
				user.id,
				params.id,
				query.offset,
			);
			if (!result) {
				return apiFailure(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
			}
			return apiSuccess(result);
		},
		{
			auth: true,
			query: t.Object({ offset: t.Numeric({ minimum: 0 }) }),
		},
	);
