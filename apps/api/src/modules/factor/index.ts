import { Elysia } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import { FactorService } from "./service";
import { FactorQuery, UpdateSelectedFactorsBody } from "./model";

export const factorModule = new Elysia({ prefix: "/factors", name: "factor" })
	.use(betterAuthPlugin)
	.get("/selection", ({ user }) => FactorService.getSelectedFactors(user.id), {
		auth: true,
	})
	.put(
		"/selection",
		async ({ user, body, set }) => {
			const result = await FactorService.setSelectedFactors(user.id, body.factorIds);
			if (!result.success) set.status = 400;
			return result;
		},
		{ auth: true, body: UpdateSelectedFactorsBody },
	)
	.get(
		"/",
		({ user, query }) =>
			FactorService.listByUser(
				user.id,
				query.limit ?? 50,
				query.offset ?? 0,
				query.keyword,
			),
		{
			auth: true,
			query: FactorQuery,
		},
	);
