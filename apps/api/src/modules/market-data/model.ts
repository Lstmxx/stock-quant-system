import { t } from "elysia";

export const MarketDataSearchQuery = t.Object({
	q: t.String({ minLength: 1, maxLength: 100 }),
});

export const MarketDataSymbolParams = t.Object({
	symbol: t.String({ minLength: 1, maxLength: 20 }),
});

export type MarketDataSearchQuery = typeof MarketDataSearchQuery.static;
export type MarketDataSymbolParams = typeof MarketDataSymbolParams.static;
