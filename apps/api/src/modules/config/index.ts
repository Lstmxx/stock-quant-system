import { Elysia } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import { ConfigService } from "./service";
import { ConfigBody } from "./model";

export const configModule = new Elysia({ prefix: "/config", name: "config" })
	.use(betterAuthPlugin)
	.get("/", ({ user }) => ConfigService.listByUser(user.id), {
		auth: true,
	})
	.post(
		"/",
		({ user, body }) => ConfigService.upsert(user.id, body.key, body.value),
		{
			auth: true,
			body: ConfigBody,
		},
	);
