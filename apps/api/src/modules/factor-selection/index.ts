import { Elysia } from "elysia";
import { apiFailure, apiSuccess } from "../../lib/api-response";

import { betterAuthPlugin } from "../../plugins/auth";
import { CreateFactorSelectionBody, FactorSelectionListQuery } from "./model";
import { FactorSelectionService } from "./service";

export const factorSelectionModule = new Elysia({
	prefix: "/factor-selections",
	name: "factor-selection",
})
	.use(betterAuthPlugin)
	.post(
		"/",
		async ({ user, body }) => {
			const result = await FactorSelectionService.create(user.id, body);
			if (!result.success) return apiFailure(400, result.code, result.error);
			return apiSuccess({ taskId: result.taskId });
		},
		{ auth: true, body: CreateFactorSelectionBody },
	)
	.get(
		"/",
		async ({ user, query }) =>
			apiSuccess(await FactorSelectionService.list(user.id, query.limit ?? 20, query.offset ?? 0)),
		{ auth: true, query: FactorSelectionListQuery },
	)
	.get(
		"/:id",
		async ({ user, params }) => {
			const result = await FactorSelectionService.detail(user.id, params.id);
			if (!result) {
				return apiFailure(404, "FACTOR_SELECTION_NOT_FOUND", "选股任务不存在");
			}
			return apiSuccess(result);
		},
		{ auth: true },
	);
