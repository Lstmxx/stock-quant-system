import { db, alphaTasks, alphaFactors, userConfigs } from "@stock-quant/database";
import { eq, desc } from "drizzle-orm";
import Redis from "ioredis";
import { engineClient } from "../../lib/engine-client";
import type { AnalysisReport, StartAnalysisBody } from "./model";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

// ─── LLM Helpers ───

function getLlmConfig(configs: { key: string; value: string }[]) {
	const get = (key: string, fallback: string) =>
		configs.find((c) => c.key === key)?.value ?? fallback;

	return {
		apiKey: get("LLM_API_KEY", process.env.LLM_API_KEY ?? ""),
		baseUrl: get("LLM_BASE_URL", process.env.LLM_BASE_URL ?? "https://api.openai.com/v1"),
		model: get("LLM_MODEL", process.env.LLM_MODEL ?? "gpt-4o"),
	};
}

function buildAnalysisPrompt(symbol: string, priceStats: object, factorSummary: object): string {
	return `你是一位专业的A股量化分析师。请对以下股票数据进行综合分析，并严格按 JSON 格式返回分析结果。

## 股票代码
${symbol}

## 近期行情数据摘要
${JSON.stringify(priceStats, null, 2)}

## 已挖掘的量化因子
${JSON.stringify(factorSummary, null, 2)}

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

async function callLlm(
	apiKey: string,
	baseUrl: string,
	model: string,
	prompt: string,
): Promise<string> {
	const resp = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: prompt }],
			temperature: 0.3,
			max_tokens: 2000,
		}),
	});

	if (!resp.ok) {
		throw new Error(`LLM API error: HTTP ${resp.status}`);
	}

	const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
	return data.choices[0]?.message?.content ?? "";
}

// ─── Market Data Helpers ───

async function getMarketDataFromRedis(symbol: string, days: number): Promise<object | null> {
	const today = new Date().toISOString().slice(0, 10);
	const key = `market_data:${today}_${days}`;
	const raw = await redis.get(key);
	if (!raw) return null;
	// The pickled data is a Python dict; we only check presence here.
	// Actual analysis uses summary stats fetched from a separate key.
	return { cached: true, key };
}

async function getPriceSummary(symbol: string): Promise<object> {
	// We store daily price stats as a lightweight JSON summary alongside the heavy pickle
	const key = `price_summary:${symbol}:${new Date().toISOString().slice(0, 10)}`;
	const raw = await redis.get(key);
	if (raw) return JSON.parse(raw);
	// Fallback: return minimal placeholder (Engine has not yet written stats)
	return { symbol, note: "stats pending — data fetch in progress" };
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
				await new Promise<void>((resolve) => {
					const sub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
					const channel = `data_ready:${symbol}`;
					const timeout = setTimeout(() => {
						sub.quit();
						resolve(); // proceed anyway with empty stats
					}, 60_000);
					sub.subscribe(channel);
					sub.on("message", () => {
						clearTimeout(timeout);
						sub.quit();
						resolve();
					});
				});
			}

			// 4. Fetch price summary stats + latest alpha factors
			const priceStats = await getPriceSummary(symbol);
			const factors = await db
				.select()
				.from(alphaFactors)
				.where(eq(alphaFactors.userId, userId))
				.orderBy(desc(alphaFactors.icValue))
				.limit(5);

			const factorSummary = factors.map((f) => ({
				expression: f.expression,
				icValue: f.icValue,
				icir: f.icir,
				direction: f.direction,
			}));

			// 5. Get user LLM config
			const userCfgs = await db
				.select()
				.from(userConfigs)
				.where(eq(userConfigs.userId, userId));
			const { apiKey, baseUrl, model } = getLlmConfig(userCfgs);

			if (!apiKey) throw new Error("LLM API Key not configured. Please set it in Settings.");

			// 6. Call LLM
			const prompt = buildAnalysisPrompt(symbol, priceStats, factorSummary);
			const rawReport = await callLlm(apiKey, baseUrl, model, prompt);

			// 7. Parse structured JSON from LLM response
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
				factors: factorSummary as AnalysisReport["factors"],
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
			.where(eq(alphaTasks.id, taskId));
		if (!task || task.userId !== userId) return null;
		return task;
	}
}
