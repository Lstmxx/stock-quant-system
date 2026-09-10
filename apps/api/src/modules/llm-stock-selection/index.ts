import { Elysia } from "elysia";
import { apiFailure, apiSuccess } from "../../lib/api-response";

import { betterAuthPlugin } from "../../plugins/auth";
import {
	CreateLlmStockSelectionBody,
	LlmStockSelectionListQuery,
	LlmStockSelectionResultQuery,
	RetryFailedLlmStockSelectionBody,
} from "./model";
import { LlmStockSelectionService } from "./service";

export const llmStockSelectionModule = new Elysia({
	prefix: "/llm-stock-selections",
	name: "llm-stock-selection",
})
	.use(betterAuthPlugin)
	.post(
		"/",
		async ({ user, body }) => apiSuccess(await LlmStockSelectionService.create(user.id, body)),
		{ auth: true, body: CreateLlmStockSelectionBody },
	)
	.get(
		"/",
		async ({ user, query }) =>
			apiSuccess(await LlmStockSelectionService.list(
				user.id,
				query.limit ?? 20,
				query.offset ?? 0,
			)),
		{ auth: true, query: LlmStockSelectionListQuery },
	)
	.get(
		"/:id",
		async ({ user, params }) => {
			const detail = await LlmStockSelectionService.detail(user.id, params.id);
			return detail ? apiSuccess(detail) : apiFailure(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
		},
		{ auth: true },
	)
	.get(
		"/:id/results",
		async ({ user, params, query }) => {
			const results = await LlmStockSelectionService.results(
				user.id,
				params.id,
				query.view ?? "selected",
				query.limit ?? 50,
				query.offset ?? 0,
			);
			return results ? apiSuccess(results) : apiFailure(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
		},
		{ auth: true, query: LlmStockSelectionResultQuery },
	)
	.get(
		"/:id/results/:symbol",
		async ({ user, params }) => {
			const detail = await LlmStockSelectionService.stockDetail(
				user.id,
				params.id,
				params.symbol,
			);
			return detail ? apiSuccess(detail) : apiFailure(404, "NOT_FOUND", "股票结果不存在或无权访问");
		},
		{ auth: true },
	)
	.post(
		"/:id/cancel",
		async ({ user, params }) => {
			const result = await LlmStockSelectionService.cancel(user.id, params.id);
			if (!result) return apiFailure(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
			if (!result.success) return apiFailure(404, result.code, result.error);
			return apiSuccess({ status: result.status });
		},
		{ auth: true },
	)
	.post(
		"/:id/retry-failed",
		async ({ user, params, body }) => apiSuccess(await LlmStockSelectionService.retryFailed(
			user.id,
			params.id,
			body.symbols,
		)),
		{ auth: true, body: RetryFailedLlmStockSelectionBody },
	);
