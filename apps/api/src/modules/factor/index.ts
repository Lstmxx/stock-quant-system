import { Elysia } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import { FactorService } from "./service";
import { FactorQuery } from "./model";

export const factorModule = new Elysia({ prefix: "/factors", name: "factor" })
	.use(betterAuthPlugin)
	.get(
		"/",
		({ user, query }) => {
			const limit = query.limit ? parseInt(query.limit, 10) : 50;
			const offset = query.offset ? parseInt(query.offset, 10) : 0;
			return FactorService.listByUser(user.id, limit, offset, query.keyword);
		},
		{
			auth: true,
			query: FactorQuery,
		},
	);
