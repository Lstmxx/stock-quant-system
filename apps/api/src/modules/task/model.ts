import { t } from "elysia";

export const CreateTaskBody = t.Object({
	targetSymbol: t.String(),
	days: t.Optional(t.Number()),
});

export type CreateTaskBody = typeof CreateTaskBody.static;
