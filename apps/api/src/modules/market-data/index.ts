import { Elysia } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import {
	MarketDataSearchQuery,
	MarketDataSymbolParams,
} from "./model";
import { MarketDataError, MarketDataService } from "./service";

function handleMarketDataError(error: unknown, set: { status?: number | string }) {
	if (error instanceof MarketDataError) {
		set.status = error.status;
		return { success: false as const, code: error.code, message: error.message };
	}
	throw error;
}

export const marketDataModule = new Elysia({
	prefix: "/market-data",
	name: "market-data",
})
	.use(betterAuthPlugin)
	.get(
		"/search",
		async ({ query, set }) => {
			try {
				return await MarketDataService.search(query.q);
			} catch (error) {
				return handleMarketDataError(error, set);
			}
		},
		{ auth: true, query: MarketDataSearchQuery },
	)
	.get(
		"/:symbol/kline",
		async ({ params, set }) => {
			try {
				return await MarketDataService.getKline(params.symbol);
			} catch (error) {
				return handleMarketDataError(error, set);
			}
		},
		{ auth: true, params: MarketDataSymbolParams },
	);
