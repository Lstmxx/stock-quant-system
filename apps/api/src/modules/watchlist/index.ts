import { Elysia } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import { WatchlistService } from "./service";
import { WatchlistBody } from "./model";

export const watchlistModule = new Elysia({
	prefix: "/watchlists",
	name: "watchlist",
})
	.use(betterAuthPlugin)
	.get("/", ({ user }) => WatchlistService.listByUser(user.id), {
		auth: true,
	})
	.post(
		"/",
		({ user, body }) =>
			WatchlistService.create(user.id, body.symbol, body.name),
		{
			auth: true,
			body: WatchlistBody,
		},
	)
	.delete(
		"/:id",
		({ user, params }) => WatchlistService.remove(user.id, params.id),
		{ auth: true },
	);
