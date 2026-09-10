import { Elysia } from "elysia";
import { apiSuccess } from "../../lib/api-response";
import { betterAuthPlugin } from "../../plugins/auth";
import { WatchlistService } from "./service";
import { WatchlistBody } from "./model";

export const watchlistModule = new Elysia({
	prefix: "/watchlists",
	name: "watchlist",
})
	.use(betterAuthPlugin)
	.get("/", async ({ user }) => apiSuccess(await WatchlistService.listByUser(user.id)), {
		auth: true,
	})
	.post(
		"/",
		async ({ user, body }) =>
			apiSuccess(await WatchlistService.create(user.id, body.symbol, body.name)),
		{
			auth: true,
			body: WatchlistBody,
		},
	)
	.delete(
		"/:id",
		async ({ user, params }) => {
			await WatchlistService.remove(user.id, params.id);
			return apiSuccess(null);
		},
		{ auth: true },
	);
