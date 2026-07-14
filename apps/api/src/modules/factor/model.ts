import { t } from "elysia";

export const FactorQuery = t.Object({
	limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1, default: 50 })),
	offset: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1, default: 0 })),
	keyword: t.Optional(t.String()),
});

export const UpdateSelectedFactorsBody = t.Object({
	factorIds: t.Array(t.String({ format: "uuid" }), { maxItems: 20 }),
});

export type FactorQuery = typeof FactorQuery.static;
