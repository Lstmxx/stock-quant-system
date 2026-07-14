import { t } from "elysia";

export const UniverseType = t.Union([
	t.Literal("ALL_MARKET"),
	t.Literal("WATCHLIST"),
]);

export const CreateFactorSelectionBody = t.Object({
	universeType: UniverseType,
	topN: t.Integer({ minimum: 1, maximum: 100, default: 20 }),
	lookbackDays: t.Optional(t.Integer({ minimum: 30, maximum: 1000, default: 250 })),
});

export const FactorSelectionListQuery = t.Object({
	limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
	offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
});

export type CreateFactorSelectionBody = typeof CreateFactorSelectionBody.static;
