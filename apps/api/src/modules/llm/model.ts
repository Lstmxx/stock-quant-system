import { t } from "elysia";

export const CreateLlmBody = t.Object({
    provider: t.String(),
    modelName: t.String(),
    name: t.String(),
    baseUrl: t.Optional(t.String()),
    apiKey: t.Optional(t.String()),
    isDefault: t.Optional(t.Boolean())
});

export const UpdateLlmBody = t.Object({
    provider: t.Optional(t.String()),
    modelName: t.Optional(t.String()),
    name: t.Optional(t.String()),
    baseUrl: t.Optional(t.String()),
    apiKey: t.Optional(t.String()),
    isDefault: t.Optional(t.Boolean())
});
