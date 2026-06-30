import { t } from "elysia";

export const ConfigBody = t.Object({
	key: t.String(),
	value: t.String(),
});

export type ConfigBody = typeof ConfigBody.static;
