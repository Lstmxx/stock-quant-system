import { Elysia } from "elysia";
import { betterAuthPlugin } from "../../plugins/auth";
import { LlmService } from "./service";
import { CreateLlmBody, UpdateLlmBody } from "./model";

export const llmModule = new Elysia({ prefix: "/llm", name: "llm" })
    .use(betterAuthPlugin)
    .get("/", ({ user }) => LlmService.listByUser(user.id), { auth: true })
    .post("/", ({ user, body }) => LlmService.create(user.id, body), { auth: true, body: CreateLlmBody })
    .put("/:id", ({ user, params, body }) => LlmService.update(user.id, params.id, body), { auth: true, body: UpdateLlmBody })
    .delete("/:id", ({ user, params }) => LlmService.delete(user.id, params.id), { auth: true })
    .post("/:id/default", ({ user, params }) => LlmService.setDefault(user.id, params.id), { auth: true });
