import { t } from "elysia";

export const LLM_PROVIDERS = [
	"openai",
	"anthropic",
	"ollama",
	"openai_compatible",
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export type ApiKeyAction = "keep" | "replace" | "clear";

export const LlmProviderSchema = t.Union([
	t.Literal("openai"),
	t.Literal("anthropic"),
	t.Literal("ollama"),
	t.Literal("openai_compatible"),
]);

const NameSchema = t.String({ minLength: 1, maxLength: 100 });
const ModelNameSchema = t.String({ minLength: 1, maxLength: 200 });
const BaseUrlSchema = t.String({ minLength: 1, maxLength: 500 });
const ApiKeySchema = t.String({ minLength: 1, maxLength: 2000 });

export const CreateLlmBody = t.Object({
	provider: LlmProviderSchema,
	modelName: ModelNameSchema,
	name: NameSchema,
	baseUrl: t.Optional(BaseUrlSchema),
	apiKey: t.Optional(ApiKeySchema),
	isDefault: t.Optional(t.Boolean()),
});

export const UpdateLlmBody = t.Object({
	provider: t.Optional(LlmProviderSchema),
	modelName: t.Optional(ModelNameSchema),
	name: t.Optional(NameSchema),
	baseUrl: t.Optional(t.Nullable(BaseUrlSchema)),
	apiKeyAction: t.Optional(
		t.Union([t.Literal("keep"), t.Literal("replace"), t.Literal("clear")]),
	),
	apiKey: t.Optional(ApiKeySchema),
	isDefault: t.Optional(t.Boolean()),
});

export type CreateLlmInput = typeof CreateLlmBody.static;
export type UpdateLlmInput = typeof UpdateLlmBody.static;

export interface LlmModelView {
	id: string;
	provider: LlmProvider;
	modelName: string;
	name: string;
	baseUrl: string | null;
	hasApiKey: boolean;
	isDefault: boolean;
	createdAt: Date;
	updatedAt: Date;
}
