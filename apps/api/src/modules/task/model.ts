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

export const DataCollectionConfigBody = t.Object({
	lookbackDays: t.Integer({ minimum: 1, maximum: 5000 }),
	workerCount: t.Integer({ minimum: 1, maximum: 16 }),
	cronExpression: t.String({
		minLength: 9,
		maxLength: 100,
		pattern: "^\\S+( \\S+){4}$",
	}),
});

export const DataCollectionListQuery = t.Object({
	limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 50 })),
	offset: t.Optional(t.Numeric({ minimum: 0, default: 0 })),
});

export interface WorkerProgress {
	worker_id: number;
	total: number;
	success: number;
	failed: number;
	current_code: string | null;
	status: "running" | "partial" | "failed" | "completed" | "cancelled";
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseWorkerProgress(raw: string): WorkerProgress | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	if (!("worker_id" in value) || !isCount(value.worker_id)) return null;
	if (!("total" in value) || !isCount(value.total)) return null;
	if (!("success" in value) || !isCount(value.success)) return null;
	if (!("failed" in value) || !isCount(value.failed)) return null;
	if (!("status" in value)) return null;
	const currentCode = "current_code" in value ? value.current_code : null;
	if (currentCode !== null && typeof currentCode !== "string") return null;
	const workerStatus = value.status;
	if (workerStatus !== "running" && workerStatus !== "partial" && workerStatus !== "failed"
		&& workerStatus !== "completed" && workerStatus !== "cancelled") return null;
	return {
		worker_id: value.worker_id,
		total: value.total,
		success: value.success,
		failed: value.failed,
		current_code: currentCode,
		status: workerStatus,
	};
}
