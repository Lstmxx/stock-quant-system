import { db, alphaFactors, quantStrategies } from "@stock-quant/database";
import { and, eq, desc } from "drizzle-orm";
import { engineClient } from "../../lib/engine-client";
import { LlmService } from "../llm/service";
import type { GenerateReportBody, SimulateBody } from "./model";

export class StrategyService {
	/**
	 * Beat 1: Recommend factors based on investment style
	 */
	static async recommendFactors(userId: string, _style: string) {
		// Mock logic: Fetch valid factors, sort by IC, maybe filter by some heuristic
		// In a real scenario, LLM might pick the best factors or filter by formula text
		const factors = await db
			.select()
			.from(alphaFactors)
			.where(eq(alphaFactors.userId, userId))
			.orderBy(desc(alphaFactors.icValue))
			.limit(10);
			
		// Return top 3 as recommendations
		return factors.slice(0, 3);
	}

	static async simulateFactor(
		userId: string,
		factorId: string,
		_constraints: SimulateBody["constraints"],
	) {
		const factor = await db
			.select()
			.from(alphaFactors)
			.where(and(eq(alphaFactors.id, factorId), eq(alphaFactors.userId, userId)))
			.limit(1)
			.then((res) => res[0]);

		if (!factor) throw new Error("Factor not found");

		const result = await engineClient.simulateFactor(factor.expression, 250);

		if (result.status !== "ok") {
			throw new Error(result.message || "Simulation failed");
		}

		return {
			factorId,
			...result.data
		};
	}

	/**
	 * Beat 3: Generate structured JSON report via LLM and save it
	 */
	static async generateReportStructured(userId: string, body: GenerateReportBody) {
		const prompt = `你是一个资深的量化金融分析师。
用户经过交互式策略构建选择了以下因子：
投资风格：${body.style}
因子ID：${body.factorId}
真实回测表现：${JSON.stringify(body.simulationResult)}
约束条件：${JSON.stringify(body.constraints)}

请基于上述回测结果和因子逻辑，生成一份结构化的策略分析报告。
【强制要求】
请必须返回合法的 JSON 格式，不要包含任何 Markdown 标记或多余文字，格式如下：
{
  "summary": "一句话核心总结（50字以内）",
  "intuition": "该因子背后的经济学直觉和逻辑深入剖析",
  "performanceAnalysis": "结合给出的年化收益、最大回撤、夏普等指标，评价该因子的表现优劣",
  "riskWarning": "该因子在极端市场下可能面临的风险与失效场景",
  "radarData": [
    { "name": "收益能力", "value": 85 },
    { "name": "抗风险", "value": 70 },
    { "name": "稳定性", "value": 60 },
    { "name": "胜率", "value": 75 },
    { "name": "动量捕捉", "value": 80 }
  ]
}
注意：radarData 的 value 请根据回测表现主观打分（0-100）。`;

		const llmResult = await LlmService.chatDefault(userId, {
			messages: [{ role: "user", content: prompt }],
			temperature: 0.7,
			maxTokens: 3000,
			jsonMode: true,
		});
		const reportContent = llmResult.content;
		let structuredReport;
		try {
			structuredReport = JSON.parse(reportContent);
		} catch (e) {
			structuredReport = { summary: "解析大模型返回结果失败", error: reportContent };
		}

		// Save the strategy to the database
		await db.insert(quantStrategies).values({
			userId,
			name: `${body.style} Strategy based on Factor ${body.factorId.slice(0, 6)}`,
			style: body.style,
			factors: [body.factorId],
			constraints: body.constraints,
			reportMarkdown: reportContent,
			performance: body.simulationResult
		});

		return structuredReport;
	}
}
