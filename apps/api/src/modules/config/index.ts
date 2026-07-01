import { Elysia } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import { ConfigService } from "./service";
import { ConfigBody } from "./model";
import { engineClient } from "../../lib/engine-client";

export const configModule = new Elysia({ prefix: "/config", name: "config" })
	.use(betterAuthPlugin)
	.get("/", ({ user }) => ConfigService.listByUser(user.id), {
		auth: true,
	})
	.post(
		"/",
		async ({ user, body }) => {
			const res = await ConfigService.upsert(user.id, body.key, body.value);

			// Notify engine to reload scheduler/config on any config change
			// If it's the baostock cron config, pass it along.
			const configs = await ConfigService.listByUser(user.id);
			const cronCfg = configs.find(c => c.key === 'BAOSTOCK_CRON');
			
			await engineClient.reloadConfig(cronCfg?.value);

			return res;
		},
		{
			auth: true,
			body: ConfigBody,
		},
	);
