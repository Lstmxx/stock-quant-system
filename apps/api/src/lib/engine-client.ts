/**
 * EngineClient — 封装所有与 FastAPI Engine 的 HTTP 通信
 *
 * - Engine URL 从 ENGINE_URL 环境变量读取，默认 http://localhost:8000
 * - 调度/数据辅助调用保持 fail-soft；LLM 调用 fail-closed 并返回领域错误
 */

const ENGINE_BASE_URL = process.env.ENGINE_URL ?? `http://localhost:${process.env.PORT_ENGINE || "8000"}`;
const TIMEOUT_MS = 5000;
const LLM_TIMEOUT_MS = 190_000;

export interface EngineChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface EngineChatInput {
	userId: string;
	modelId: string;
	messages: EngineChatMessage[];
	temperature?: number;
	maxTokens?: number;
	jsonMode?: boolean;
}

export interface EngineChatResult {
	content: string;
	provider: "openai" | "anthropic" | "ollama" | "openai_compatible";
	model: string;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	} | null;
}

export class EngineClientError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(
		code: string,
		message: string,
		status: number,
	) {
		super(message);
		this.name = "EngineClientError";
		this.code = code;
		this.status = status;
	}
}

async function engineFetch(
	path: string,
	options: RequestInit = {},
	timeoutMs = TIMEOUT_MS,
): Promise<Response | null> {
	const url = `${ENGINE_BASE_URL}${path}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers ?? {}),
			},
		});
		return response;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			console.error(`[EngineClient] Request to ${url} timed out after ${timeoutMs}ms`);
		} else {
			console.error(`[EngineClient] Request to ${url} failed:`, err);
		}
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function parseEngineError(response: Response): Promise<EngineClientError> {
	let code = "LLM_PROVIDER_UNAVAILABLE";
	let message = `Engine LLM request failed: HTTP ${response.status}`;
	try {
		const payload = (await response.json()) as {
			code?: unknown;
			message?: unknown;
		};
		if (typeof payload.code === "string") code = payload.code;
		if (typeof payload.message === "string") message = payload.message;
	} catch {
		// Keep the sanitized HTTP fallback.
	}
	return new EngineClientError(code, message, response.status);
}

async function llmRequest<T>(path: string, body: object): Promise<T> {
	const response = await engineFetch(
		path,
		{
			method: "POST",
			body: JSON.stringify(body),
		},
		LLM_TIMEOUT_MS,
	);
	if (!response) {
		throw new EngineClientError(
			"LLM_PROVIDER_UNAVAILABLE",
			"Engine LLM 服务不可用",
			502,
		);
	}
	if (!response.ok) throw await parseEngineError(response);
	return (await response.json()) as T;
}

export const engineClient = {
	/**
	 * 通知 Engine 重新加载调度配置（如 Baostock 定时任务的 cron 表达式）
	 */
	async reloadConfig(cron?: string): Promise<boolean> {
		const res = await engineFetch("/internal/reload-config", {
			method: "POST",
			body: cron ? JSON.stringify({ baostock_cron: cron }) : undefined,
		});
		if (!res) return false;
		if (!res.ok) {
			console.error(`[EngineClient] reloadConfig failed: HTTP ${res.status}`);
			return false;
		}
		return true;
	},

	/**
	 * 触发 Engine 拉取指定股票的行情数据并缓存到 Redis
	 * @param symbol  股票代码，e.g. "sh.600000"
	 * @param days    回溯天数，默认 250
	 */
	async triggerDataFetch(symbol: string, days = 250): Promise<void> {
		const res = await engineFetch("/internal/fetch-data", {
			method: "POST",
			body: JSON.stringify({ symbol, days }),
		});
		if (!res) return;
		if (!res.ok) {
			console.error(`[EngineClient] triggerDataFetch(${symbol}) failed: HTTP ${res.status}`);
		}
	},

	/**
	 * 检查 Engine 健康状态
	 */
	async getHealth(): Promise<{ status: string; version?: string } | null> {
		const res = await engineFetch("/health");
		if (!res || !res.ok) return null;
		return res.json();
	},

	/**
	 * 请求 Engine 模拟执行因子
	 */
	async simulateFactor(expression: string, days = 250): Promise<any> {
		const res = await engineFetch("/internal/simulate-factor", {
			method: "POST",
			body: JSON.stringify({ expression, days }),
		});
		if (!res || !res.ok) {
			throw new Error("Factor simulation failed");
		}
		return res.json();
	},

	async chatLlm(input: EngineChatInput): Promise<EngineChatResult> {
		return llmRequest<EngineChatResult>("/internal/llm/chat", input);
	},

	async testLlm(
		userId: string,
		modelId: string,
	): Promise<{ success: true; provider: EngineChatResult["provider"]; model: string }> {
		return llmRequest("/internal/llm/test", { userId, modelId });
	},
} as const;
