import { t } from "elysia";

export const WatchlistBody = t.Object({
	symbol: t.String(),
	name: t.Optional(t.String()),
});

export type WatchlistBody = typeof WatchlistBody.static;
