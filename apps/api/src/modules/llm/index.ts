import { Elysia, status } from "elysia";

import { betterAuthPlugin } from "../../plugins/auth";
import { EngineClientError } from "../../lib/engine-client";
import { CreateLlmBody, UpdateLlmBody } from "./model";
import {
	LlmService,
	LlmServiceError,
	LlmValidationError,
} from "./service";

async function handleLlmRequest<T>(operation: () => Promise<T>) {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof LlmServiceError) {
			return status(error.status, { code: error.code, message: error.message });
		}
		if (error instanceof LlmValidationError) {
			return status(422, { code: error.code, message: error.message });
		}
		if (error instanceof EngineClientError) {
			return status(error.status, { code: error.code, message: error.message });
		}
		throw error;
	}
}

export const llmModule = new Elysia({ prefix: "/llm", name: "llm" })
	.use(betterAuthPlugin)
	.get("/", ({ user }) => LlmService.listByUser(user.id), { auth: true })
	.post(
		"/",
		({ user, body }) => handleLlmRequest(() => LlmService.create(user.id, body)),
		{ auth: true, body: CreateLlmBody },
	)
	.put(
		"/:id",
		({ user, params, body }) =>
			handleLlmRequest(() => LlmService.update(user.id, params.id, body)),
		{ auth: true, body: UpdateLlmBody },
	)
	.delete(
		"/:id",
		({ user, params }) =>
			handleLlmRequest(() => LlmService.delete(user.id, params.id)),
		{ auth: true },
	)
	.post(
		"/:id/default",
		({ user, params }) =>
			handleLlmRequest(() => LlmService.setDefault(user.id, params.id)),
		{ auth: true },
	)
	.post(
		"/:id/test",
		({ user, params }) =>
			handleLlmRequest(() => LlmService.testConnection(user.id, params.id)),
		{ auth: true },
	);
