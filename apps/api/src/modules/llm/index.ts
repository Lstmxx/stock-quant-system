import { Elysia } from "elysia";
import { apiSuccess } from "../../lib/api-response";

import { betterAuthPlugin } from "../../plugins/auth";
import { CreateLlmBody, UpdateLlmBody } from "./model";
import { LlmService } from "./service";

export const llmModule = new Elysia({ prefix: "/llm", name: "llm" })
	.use(betterAuthPlugin)
	.get("/", async ({ user }) => apiSuccess(await LlmService.listByUser(user.id)), { auth: true })
	.post(
		"/",
		async ({ user, body }) => apiSuccess(await LlmService.create(user.id, body)),
		{ auth: true, body: CreateLlmBody },
	)
	.put(
		"/:id",
		async ({ user, params, body }) => apiSuccess(await LlmService.update(user.id, params.id, body)),
		{ auth: true, body: UpdateLlmBody },
	)
	.delete(
		"/:id",
		async ({ user, params }) => {
			await LlmService.delete(user.id, params.id);
			return apiSuccess(null);
		},
		{ auth: true },
	)
	.post(
		"/:id/default",
		async ({ user, params }) => apiSuccess(await LlmService.setDefault(user.id, params.id)),
		{ auth: true },
	)
	.post(
		"/:id/test",
		async ({ user, params }) => {
			const { provider, model } = await LlmService.testConnection(user.id, params.id);
			return apiSuccess({ provider, model });
		},
		{ auth: true },
	);
