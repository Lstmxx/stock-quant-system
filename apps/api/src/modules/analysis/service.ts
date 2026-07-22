import { createHash } from "node:crypto";

import { db, alphaTasks, factorSelectionResults } from "@stock-quant/database";
import { and, eq, desc } from "drizzle-orm";
import Redis from "ioredis";
import { redisUrl } from "../../lib/env";
import { engineClient } from "../../lib/engine-client";
import { FactorSelectionService, resolveFactorSet } from "../factor-selection/service";
import { LlmService } from "../llm/service";
import type { AnalysisReport, FactorAnalysisContext, StartAnalysisBody } from "./model";

export function buildAnalysisPrompt(
	symbol: string,
	priceStats: object,
	factorContext: FactorAnalysisContext,
): string {
	return `你是一位专业的A股量化分析师。请对以下股票数据进行综合分析，并严格按 JSON 格式返回分析结果。

## 股票代码
${symbol}

## 近期行情数据摘要
${JSON.stringify(priceStats, null, 2)}

## 该股票的因子选股快照
${JSON.stringify(factorContext, null, 2)}

请结合综合排名、各因子的实际值、方向调整后的 z-score、股票池百分位和得分贡献进行解释。不得把因子定义或历史 IC 当成该股票当前的实际暴露。

## 输出要求
请返回严格符合以下结构的 JSON（不要包含任何额外文字）：
{
  "name": "股票名称（若不知道则返回代码）",
  "summary": "一句话综合评价（50字内）",
  "overallScore": 0到100的整数评分,
  "trend": {
    "direction": "UP" 或 "DOWN" 或 "SIDEWAYS",
    "strength": 0到1的浮点数,
    "description": "趋势描述（100字内）"
  },
  "signals": [
    { "type": "信号类型", "value": 数值, "label": "信号标签", "sentiment": "BULLISH或BEARISH或NEUTRAL" }
  ],
  "risk": {
    "level": "LOW" 或 "MEDIUM" 或 "HIGH",
    "notes": "风险说明（100字内）"
  },
  "recommendation": "BUY" 或 "HOLD" 或 "SELL" 或 "WATCH"
}`;
}

function shanghaiDate(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

function toFactorContext(candidate: {
	selection: typeof factorSelectionResults.$inferSelect;
	task: typeof alphaTasks.$inferSelect;
}): FactorAnalysisContext {
	const params = (candidate.task.params ?? {}) as { universeType?: unknown };
	return {
		selectionTaskId: candidate.task.id,
		dataDate: candidate.selection.dataDate,
		universeType: params.universeType === "WATCHLIST" ? "WATCHLIST" : "ALL_MARKET",
		symbol: candidate.selection.symbol,
		compositeScore: candidate.selection.compositeScore,
		rank: candidate.selection.rank,
		factorContributions: candidate.selection.factorContributions,
	};
}

async function findCompatibleFactorContext(
	userId: string,
	symbol: string,
	factorSetHash: string,
	dataDate: string,
): Promise<FactorAnalysisContext | null> {
	const candidates = await db
		.select({ selection: factorSelectionResults, task: alphaTasks })
		.from(factorSelectionResults)
		.innerJoin(
			alphaTasks,
			and(
				eq(alphaTasks.id, factorSelectionResults.taskId),
				eq(alphaTasks.userId, userId),
				eq(alphaTasks.type, "FACTOR_SELECTION"),
				eq(alphaTasks.status, "COMPLETED"),
			),
		)
		.where(
			and(
				eq(factorSelectionResults.userId, userId),
				eq(factorSelectionResults.symbol, symbol),
			),
		)
		.orderBy(desc(alphaTasks.createdAt));

	const compatible = candidates.find(({ task }) => {
		const params = (task.params ?? {}) as Record<string, unknown>;
		return params.factorSetHash === factorSetHash && params.dataDate === dataDate;
	});
	return compatible ? toFactorContext(compatible) : null;
}

async function waitForSelectionTask(
	userId: string,
	taskId: string,
	timeoutMs = 90_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const [task] = await db
			.select({ status: alphaTasks.status, result: alphaTasks.result })
			.from(alphaTasks)
			.where(and(eq(alphaTasks.id, taskId), eq(alphaTasks.userId, userId)));
		if (!task) throw new Error("自动选股任务不存在或无权访问");
		if (task.status === "COMPLETED") return;
		if (task.status === "FAILED" || task.status === "CANCELLED") {
			throw new Error(`自动选股任务未完成: ${JSON.stringify(task.result)}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	throw new Error("等待因子选股结果超时，请稍后重试");
}

async function getOrCreateFactorContext(
	userId: string,
	symbol: string,
): Promise<FactorAnalysisContext> {
	const { factors } = await resolveFactorSet(userId);
	if (factors.length === 0) throw new Error("暂无有效因子，无法进行个股因子分析");
	const factorIds = factors.map((factor) => factor.id).sort();
	const factorSetHash = createHash("sha256").update(factorIds.join(",")).digest("hex");
	const dataDate = shanghaiDate();
	const existing = await findCompatibleFactorContext(userId, symbol, factorSetHash, dataDate);
	if (existing) return existing;

	const created = await FactorSelectionService.create(userId, {
		universeType: "ALL_MARKET",
		topN: 20,
		lookbackDays: 250,
	});
	if (!created.success) throw new Error(created.error);
	await waitForSelectionTask(userId, created.taskId);
	const context = await findCompatibleFactorContext(userId, symbol, factorSetHash, dataDate);
	if (!context) throw new Error(`选股结果中没有股票 ${symbol} 的完整因子暴露`);
	return context;
}

// ─── Market Data Helpers ───

async function getMarketDataFromRedis(_symbol: string, days: number): Promise<object | null> {
	const today = new Date().toISOString().slice(0, 10);
	const key = `market_data:${today}_${days}`;
	const client = new Redis(redisUrl);
	const raw = await client.get(key).finally(() => client.quit());
	if (!raw) return null;
	// The pickled data is a Python dict; we only check presence here.
	// Actual analysis uses summary stats fetched from a separate key.
	return { cached: true, key };
}

async function getPriceSummary(symbol: string): Promise<object | null> {
	// We store daily price stats as a lightweight JSON summary alongside the heavy pickle
	const key = `price_summary:${symbol}:${new Date().toISOString().slice(0, 10)}`;
	const client = new Redis(redisUrl);
	const raw = await client.get(key).finally(() => client.quit());
	if (raw) return JSON.parse(raw);
	// Fallback: return minimal placeholder (Engine has not yet written stats)
		return null;
}

// ─── Main Service ───

export abstract class AnalysisService {
	static async startAnalysis(
		userId: string,
		body: StartAnalysisBody,
	): Promise<{ taskId: string }> {
		const symbol = body.symbol;
		const days = body.days ?? 90;

		// 1. Create task record (PENDING)
		const [task] = await db
			.insert(alphaTasks)
			.values({
				userId,
				type: "LLM_ANALYSIS",
				status: "PENDING",
				params: { symbol, days, analysisType: body.type },
			})
			.returning();

		// 2. Launch analysis in background (don't await)
		AnalysisService._runAnalysis(task.id, userId, symbol, days).catch((err) => {
			console.error(`[AnalysisService] Background task ${task.id} failed:`, err);
		});

		return { taskId: task.id };
	}

	private static async _setStatus(taskId: string, status: string, result?: object) {
		await db
			.update(alphaTasks)
			.set({ status, ...(result ? { result } : {}), updatedAt: new Date() })
			.where(eq(alphaTasks.id, taskId));
	}

	private static async _runAnalysis(
		taskId: string,
		userId: string,
		symbol: string,
		days: number,
	) {
		await AnalysisService._setStatus(taskId, "RUNNING");

		try {
			// 3. Check Redis for market data; if missing trigger Engine fetch
			const cached = await getMarketDataFromRedis(symbol, days);
			if (!cached) {
				await engineClient.triggerDataFetch(symbol, days);
				// Wait up to 60s for engine to publish data ready signal
					await new Promise<void>((resolve, reject) => {
					const sub = new Redis(redisUrl);
					const channel = `data_ready:${symbol}`;
					const timeout = setTimeout(() => {
						sub.quit();
						clearTimeout(timeout);
						sub.quit();
						reject(new Error("行情数据准备超时，请稍后重试"));
					}, 60_000);
					sub.subscribe(channel);
					sub.on("message", () => {
						clearTimeout(timeout);
						sub.quit();
						resolve();
					});
				});
			}

			// 4. Fetch price summary stats and the same persisted factor exposure
			// snapshot used by the selection UI.
				const priceStats = await getPriceSummary(symbol);
				if (!priceStats) throw new Error("行情数据不可用，无法生成分析");
			const factorContext = await getOrCreateFactorContext(userId, symbol);

			// 5. Resolve the current user's default model and call the Engine adapter.
			const prompt = buildAnalysisPrompt(symbol, priceStats, factorContext);
			const llmResult = await LlmService.chatDefault(userId, {
				messages: [{ role: "user", content: prompt }],
				temperature: 0.3,
				maxTokens: 2000,
				jsonMode: true,
			});
			const rawReport = llmResult.content;

			// 6. Parse structured JSON from LLM response
			let structuredData: Partial<AnalysisReport> = {};
			try {
				const jsonMatch = rawReport.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					structuredData = JSON.parse(jsonMatch[0]);
				}
			} catch {
				// If parsing fails, we still save the raw report
			}

			const report: AnalysisReport = {
				symbol,
				name: (structuredData.name as string) ?? symbol,
				analysisDate: new Date().toISOString().slice(0, 10),
				summary: (structuredData.summary as string) ?? "",
				overallScore: (structuredData.overallScore as number) ?? 50,
				trend: (structuredData.trend as AnalysisReport["trend"]) ?? {
					direction: "SIDEWAYS",
					strength: 0.5,
					description: "",
				},
				signals: (structuredData.signals as AnalysisReport["signals"]) ?? [],
				factors: factorContext.factorContributions,
				selectionTaskId: factorContext.selectionTaskId,
				selectionDataDate: factorContext.dataDate,
				selectionUniverseType: factorContext.universeType,
				risk: (structuredData.risk as AnalysisReport["risk"]) ?? {
					level: "MEDIUM",
					notes: "",
				},
				recommendation: (structuredData.recommendation as AnalysisReport["recommendation"]) ?? "WATCH",
				rawReport,
			};

			await AnalysisService._setStatus(taskId, "COMPLETED", report);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await AnalysisService._setStatus(taskId, "FAILED", { error: message });
		}
	}

	static async listByUser(userId: string) {
		return db
			.select()
			.from(alphaTasks)
			.where(eq(alphaTasks.userId, userId))
			.orderBy(desc(alphaTasks.createdAt));
	}

	static async getById(userId: string, taskId: string) {
		const [task] = await db
			.select()
			.from(alphaTasks)
			.where(and(eq(alphaTasks.id, taskId), eq(alphaTasks.userId, userId)));
		if (!task) return null;
		return task;
	}
}
