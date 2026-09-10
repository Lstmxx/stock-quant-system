import { Elysia } from "elysia";
import { apiSuccess } from "../../lib/api-response";
import { betterAuthPlugin } from "../../plugins/auth";
import { ConfigService } from "./service";
import { ConfigBody } from "./model";

export const configModule = new Elysia({ prefix: "/config", name: "config" })
	.use(betterAuthPlugin)
	.get("/", async ({ user }) => apiSuccess(await ConfigService.listByUser(user.id)), {
		auth: true,
	})
	.post(
		"/",
		async ({ user, body }) => {
			await ConfigService.upsert(user.id, body.key, body.value);
			return apiSuccess(null);
		},
		{
			auth: true,
			body: ConfigBody,
		},
	);
