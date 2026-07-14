import { Elysia } from "elysia";

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
		async ({ user, body, set }) => {
			const result = await FactorSelectionService.create(user.id, body);
			if (!result.success) set.status = 400;
			return result;
		},
		{ auth: true, body: CreateFactorSelectionBody },
	)
	.get(
		"/",
		({ user, query }) =>
			FactorSelectionService.list(user.id, query.limit ?? 20, query.offset ?? 0),
		{ auth: true, query: FactorSelectionListQuery },
	)
	.get(
		"/:id",
		async ({ user, params, set }) => {
			const result = await FactorSelectionService.detail(user.id, params.id);
			if (!result) {
				set.status = 404;
				return { error: "选股任务不存在" };
			}
			return result;
		},
		{ auth: true },
	);
