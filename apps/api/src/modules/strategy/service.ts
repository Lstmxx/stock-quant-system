import { db, alphaFactors, quantStrategies, userConfigs } from "@stock-quant/database";
import { eq, desc } from "drizzle-orm";

function getLlmConfig(configs: { key: string; value: string }[]) {
	const get = (key: string, fallback: string) =>
		configs.find((c) => c.key === key)?.value ?? fallback;

	return {
		apiKey: get("LLM_API_KEY", process.env.LLM_API_KEY ?? ""),
		baseUrl: get("LLM_BASE_URL", process.env.LLM_BASE_URL ?? "https://api.openai.com/v1"),
		modelName: get("LLM_MODEL", process.env.LLM_MODEL ?? "gpt-4o"),
	};
}

export class StrategyService {
	/**
	 * Beat 1: Recommend factors based on investment style
	 */
	static async recommendFactors(userId: string, style: string) {
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

	/**
	 * Beat 2: Simulate the factor
	 * (In a full implementation, this calls Engine to do a real backtest)
	 */
	static async simulateFactor(userId: string, factorId: string, constraints: any) {
		// Just a mock response for the beat flow
		return {
			factorId,
			annualReturn: 0.25 + Math.random() * 0.1,
			maxDrawdown: -0.15 + Math.random() * 0.05,
			sharpeRatio: 1.5 + Math.random(),
			winRate: 0.55 + Math.random() * 0.1
		};
	}

	/**
	 * Beat 3: Generate the final Markdown report via LLM and save it
	 * Uses @elysiajs/stream to stream the response
	 */
	static async generateReportStream(userId: string, body: any) {
		const userCfgs = await db
			.select()
			.from(userConfigs)
			.where(eq(userConfigs.userId, userId));
		const config = getLlmConfig(userCfgs);

		if (!config?.apiKey) {
			throw new Error("LLM API Key not configured");
		}

		const prompt = `You are a quantitative finance expert.
The user has gone through an interactive strategy building session.
Style: ${body.style}
Chosen Factor ID: ${body.factorId}
Simulation Results: ${JSON.stringify(body.simulationResult)}
Constraints applied: ${JSON.stringify(body.constraints)}

Write a professional, comprehensive Markdown report detailing this trading strategy.
Include an introduction, the mathematical/financial intuition behind the style, the backtest results, and risk warnings.`;

		// Return an async iterable or a ReadableStream
		// Elysia's Stream takes an async iterable
		const resp = await fetch(config.baseUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify({
				model: config.modelName,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.7,
				stream: true,
			}),
		});

		if (!resp.ok) {
			throw new Error(`LLM Error: HTTP ${resp.status}`);
		}

		// Read the SSE chunks and yield text
		// In Elysia, we can just return a Stream and yield chunks
		return {
			async *[Symbol.asyncIterator]() {
				const reader = resp.body?.getReader();
				const decoder = new TextDecoder("utf-8");
				let fullReport = "";

				if (!reader) return;

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						const chunk = decoder.decode(value, { stream: true });
						const lines = chunk.split("\n");
						for (const line of lines) {
							if (line.startsWith("data: ") && line !== "data: [DONE]") {
								try {
									const data = JSON.parse(line.slice(6));
									const text = data.choices[0]?.delta?.content || "";
									if (text) {
										fullReport += text;
										yield text;
									}
								} catch (e) {
									// ignore parse error for incomplete chunks
								}
							}
						}
					}
				} finally {
					reader.releaseLock();
					
					// Save the strategy to the database
					await db.insert(quantStrategies).values({
						userId,
						name: `${body.style} Strategy based on Factor ${body.factorId.slice(0, 6)}`,
						style: body.style,
						factors: [body.factorId],
						constraints: body.constraints,
						reportMarkdown: fullReport,
						performance: body.simulationResult
					}).catch(console.error);
				}
			}
		};
	}
}
