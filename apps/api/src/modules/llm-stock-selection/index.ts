import { Elysia } from "elysia";

import { betterAuthPlugin } from "../../plugins/auth";
import {
	CreateLlmStockSelectionBody,
	LlmStockSelectionListQuery,
	LlmStockSelectionResultQuery,
	RetryFailedLlmStockSelectionBody,
} from "./model";
import {
	LlmStockSelectionService,
	LlmStockSelectionServiceError,
} from "./service";

function serviceError(
	error: unknown,
	set: { status?: number | string },
) {
	if (!(error instanceof LlmStockSelectionServiceError)) throw error;
	set.status = error.status;
	return {
		success: false as const,
		code: error.code,
		error: error.message,
		...(error.taskId ? { taskId: error.taskId } : {}),
	};
}

export const llmStockSelectionModule = new Elysia({
	prefix: "/llm-stock-selections",
	name: "llm-stock-selection",
})
	.use(betterAuthPlugin)
	.post(
		"/",
		async ({ user, body, set }) => {
			try {
				return await LlmStockSelectionService.create(user.id, body);
			} catch (error) {
				return serviceError(error, set);
			}
		},
		{ auth: true, body: CreateLlmStockSelectionBody },
	)
	.get(
		"/",
		({ user, query }) =>
			LlmStockSelectionService.list(
				user.id,
				query.limit ?? 20,
				query.offset ?? 0,
			),
		{ auth: true, query: LlmStockSelectionListQuery },
	)
	.get(
		"/:id",
		async ({ user, params, status }) => {
			const detail = await LlmStockSelectionService.detail(user.id, params.id);
			return detail ?? status(404, { error: "任务不存在或无权访问" });
		},
		{ auth: true },
	)
	.get(
		"/:id/results",
		async ({ user, params, query, status }) => {
			const results = await LlmStockSelectionService.results(
				user.id,
				params.id,
				query.view ?? "selected",
				query.limit ?? 50,
				query.offset ?? 0,
			);
			return results ?? status(404, { error: "任务不存在或无权访问" });
		},
		{ auth: true, query: LlmStockSelectionResultQuery },
	)
	.get(
		"/:id/results/:symbol",
		async ({ user, params, status }) => {
			const detail = await LlmStockSelectionService.stockDetail(
				user.id,
				params.id,
				params.symbol,
			);
			return detail ?? status(404, { error: "股票结果不存在或无权访问" });
		},
		{ auth: true },
	)
	.post(
		"/:id/cancel",
		async ({ user, params, status }) => {
			const result = await LlmStockSelectionService.cancel(user.id, params.id);
			return result ?? status(404, { error: "任务不存在或无权访问" });
		},
		{ auth: true },
	)
	.post(
		"/:id/retry-failed",
		async ({ user, params, body, set }) => {
			try {
				return await LlmStockSelectionService.retryFailed(
					user.id,
					params.id,
					body.symbols,
				);
			} catch (error) {
				return serviceError(error, set);
			}
		},
		{ auth: true, body: RetryFailedLlmStockSelectionBody },
	);
