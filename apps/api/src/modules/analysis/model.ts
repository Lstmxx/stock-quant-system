import { t } from "elysia";

export const StartAnalysisBody = t.Object({
	symbol: t.String({ description: "股票代码, e.g. sh.600000" }),
	days: t.Optional(t.Number({ default: 90, minimum: 30, maximum: 365 })),
	type: t.Union(
		[t.Literal("SINGLE_STOCK"), t.Literal("WATCHLIST_SCAN")],
		{ description: "分析类型：单股分析 或 自选股批量扫描" }
	),
});

export type StartAnalysisBody = typeof StartAnalysisBody.static;

/**
 * JSON-structured analysis report stored in alpha_tasks.result
 */
export interface AnalysisReport {
	symbol: string;
	name: string;
	analysisDate: string;
	summary: string;
	overallScore: number; // 0-100
	trend: {
		direction: "UP" | "DOWN" | "SIDEWAYS";
		strength: number; // 0-1
		description: string;
	};
	signals: Array<{
		type: string;
		value: number;
		label: string;
		sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
	}>;
	factors: Array<{
		expression: string;
		icValue: string;
		icir: string;
		direction: string;
	}>;
	risk: {
		level: "LOW" | "MEDIUM" | "HIGH";
		notes: string;
	};
	recommendation: "BUY" | "HOLD" | "SELL" | "WATCH";
	rawReport: string;
}
