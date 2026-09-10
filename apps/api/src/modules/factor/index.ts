import { Elysia } from "elysia";
import { apiFailure, apiSuccess } from "../../lib/api-response";
import { betterAuthPlugin } from "../../plugins/auth";
import { FactorService } from "./service";
import { FactorQuery, UpdateSelectedFactorsBody } from "./model";

export const factorModule = new Elysia({ prefix: "/factors", name: "factor" })
	.use(betterAuthPlugin)
	.get("/selection", async ({ user }) => apiSuccess(await FactorService.getSelectedFactors(user.id)), {
		auth: true,
	})
	.put(
		"/selection",
		async ({ user, body }) => {
			const result = await FactorService.setSelectedFactors(user.id, body.factorIds);
			if (!result.success) return apiFailure(400, result.code, result.error);
			return apiSuccess({ mode: result.mode });
		},
		{ auth: true, body: UpdateSelectedFactorsBody },
	)
	.get(
		"/",
		async ({ user, query }) =>
			apiSuccess(await FactorService.listByUser(
				user.id,
				query.limit ?? 50,
				query.offset ?? 0,
				query.keyword,
			)),
		{
			auth: true,
			query: FactorQuery,
		},
	);
