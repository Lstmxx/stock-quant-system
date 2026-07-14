/**
 * EngineClient — 封装所有与 FastAPI Engine 的 HTTP 通信
 *
 * - Engine URL 从 ENGINE_URL 环境变量读取，默认 http://localhost:8000
 * - 错误处理策略：Fail-soft，记录日志但不抛出（避免影响 API 主流程）
 */

const ENGINE_BASE_URL = process.env.ENGINE_URL ?? `http://localhost:${process.env.PORT_ENGINE || "8000"}`;
const TIMEOUT_MS = 5000;

async function engineFetch(
	path: string,
	options: RequestInit = {},
): Promise<Response | null> {
	const url = `${ENGINE_BASE_URL}${path}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
			console.error(`[EngineClient] Request to ${url} timed out after ${TIMEOUT_MS}ms`);
		} else {
			console.error(`[EngineClient] Request to ${url} failed:`, err);
		}
		return null;
	} finally {
		clearTimeout(timer);
	}
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
} as const;
