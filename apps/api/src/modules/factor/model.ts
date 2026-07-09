import { t } from "elysia";

export const FactorQuery = t.Object({
	limit: t.Optional(t.String()),
	offset: t.Optional(t.String()),
	keyword: t.Optional(t.String()),
});

export type FactorQuery = typeof FactorQuery.static;
