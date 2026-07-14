import { t } from "elysia";

export const RESEARCH_DIRECTIONS = [
	"量价关系",
	"动量反转",
	"波动率",
	"资金流向",
	"市场情绪",
	"趋势跟踪",
] as const;

export type ResearchDirection = (typeof RESEARCH_DIRECTIONS)[number];

export const ResearchDirectionSchema = t.Union([
	t.Literal("量价关系"),
	t.Literal("动量反转"),
	t.Literal("波动率"),
	t.Literal("资金流向"),
	t.Literal("市场情绪"),
	t.Literal("趋势跟踪"),
]);

export const CreateMiningTaskBody = t.Object({
	researchDirection: ResearchDirectionSchema,
	days: t.Optional(t.Number({ minimum: 10, maximum: 1000 })),
});

export type CreateMiningTaskBody = typeof CreateMiningTaskBody.static;
