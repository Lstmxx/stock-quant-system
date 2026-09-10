import { Elysia } from "elysia";
import { apiSuccess } from "../../lib/api-response";
import { betterAuthPlugin } from "../../plugins/auth";
import {
	MarketDataSearchQuery,
	MarketDataSymbolParams,
} from "./model";
import { MarketDataService } from "./service";

export const marketDataModule = new Elysia({
	prefix: "/market-data",
	name: "market-data",
})
	.use(betterAuthPlugin)
	.get(
		"/search",
		async ({ query }) => apiSuccess(await MarketDataService.search(query.q)),
		{ auth: true, query: MarketDataSearchQuery },
	)
	.get(
		"/:symbol/kline",
		async ({ params }) => apiSuccess(await MarketDataService.getKline(params.symbol)),
		{ auth: true, params: MarketDataSymbolParams },
	);
