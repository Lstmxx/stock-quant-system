import { getRedis } from "../task/service";
import { ApiDomainError } from "../../lib/api-response";

const STOCK_LIST_KEY = "stock_list_cache";
const STOCK_NAMES_KEY = "stock_names";
const MAX_SEARCH_RESULTS = 20;

type RawKlineRow = unknown[];

export interface StockSearchResult {
	code: string;
	name: string;
}

export interface KlineBar {
	time: string;
	open: number;
	high: number;
	low: number;
	close: number;
}

export interface KlineVolumeBar {
	time: string;
	value: number;
}

export interface KlinePayload {
	symbol: string;
	name: string;
	bars: KlineBar[];
	volume: KlineVolumeBar[];
	latest: KlineBar & { volume: number; changePercent: number | null };
	range: { start: string; end: string };
}

class MarketDataError extends ApiDomainError {
	name = "MarketDataError";
}

function parseJson(value: string | null, message: string): unknown {
	if (value === null) return null;
	try {
		return JSON.parse(value);
	} catch {
		throw new MarketDataError("MARKET_DATA_INVALID", message, 502);
	}
}

function asStockCodes(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new MarketDataError(
			"STOCK_UNIVERSE_INVALID",
			"股票列表缓存格式无效，请重新执行数据采集",
			502,
		);
	}
	return [...new Set(value.filter((code): code is string => typeof code === "string"))];
}

function normalizeSearch(value: string): string {
	return value.trim().toLocaleLowerCase("zh-CN");
}

function codeMatches(code: string, query: string): boolean {
	const normalizedCode = code.toLocaleLowerCase("zh-CN");
	const numericCode = normalizedCode.split(".")[1] ?? normalizedCode;
	const compactQuery = query.replace(/^(sh|sz)\.?/, "");
	return normalizedCode.includes(query) || numericCode.includes(compactQuery);
}

function stockMatchRank(stock: StockSearchResult, query: string): number {
	const code = stock.code.toLocaleLowerCase("zh-CN");
	const name = stock.name.toLocaleLowerCase("zh-CN");
	const numericCode = code.split(".")[1] ?? code;
	if (code === query || numericCode === query.replace(/^(sh|sz)\.?/, "")) return 0;
	if (code.startsWith(query) || numericCode.startsWith(query.replace(/^(sh|sz)\.?/, ""))) return 1;
	if (name.startsWith(query)) return 2;
	return 3;
}

export function searchStocks(stocks: StockSearchResult[], query: string): StockSearchResult[] {
	const normalizedQuery = normalizeSearch(query);
	if (!normalizedQuery) return [];
	return stocks
		.filter((stock) =>
			codeMatches(stock.code, normalizedQuery)
			|| stock.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
		)
		.sort((left, right) => {
			const rankDifference = stockMatchRank(left, normalizedQuery) - stockMatchRank(right, normalizedQuery);
			return rankDifference || left.code.localeCompare(right.code);
		})
		.slice(0, MAX_SEARCH_RESULTS);
}

async function loadStockUniverse(redis: ReturnType<typeof getRedis>): Promise<StockSearchResult[]> {
	const rawList = await redis.get(STOCK_LIST_KEY);
	const codes = asStockCodes(parseJson(rawList, "股票列表缓存损坏，请重新执行数据采集"));
	if (codes.length === 0) {
		throw new MarketDataError("STOCK_UNIVERSE_EMPTY", "暂无可查询的股票，请先执行数据采集", 404);
	}

	const names = await redis.hmget(STOCK_NAMES_KEY, ...codes);
	return codes.map((code, index) => ({ code, name: names[index] ?? "" }));
}

function isValidDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function normalizeDate(value: unknown): string | null {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		value = value.toISOString().slice(0, 10);
	}
	return isValidDate(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

export function isMainBoardSymbol(symbol: string): boolean {
	return /^(sh\.60|sz\.00)\d{4}$/.test(symbol);
}

export function parseKlineRows(raw: unknown, symbol: string): Array<KlineBar & { volume: number }> {
	if (!Array.isArray(raw)) {
		throw new MarketDataError("MARKET_DATA_INVALID", "股票行情缓存格式无效", 502);
	}

	const byDate = new Map<string, KlineBar & { volume: number }>();
	for (const candidate of raw as RawKlineRow[]) {
		if (!Array.isArray(candidate) || candidate[1] !== symbol) continue;
		const time = normalizeDate(candidate[0]);
		if (time === null) continue;
		const open = finiteNumber(candidate[2]);
		const high = finiteNumber(candidate[3]);
		const low = finiteNumber(candidate[4]);
		const close = finiteNumber(candidate[5]);
		const volume = finiteNumber(candidate[6]);
		if (open === null || high === null || low === null || close === null || volume === null || close <= 0) continue;
		byDate.set(time, { time, open, high, low, close, volume });
	}

	return [...byDate.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function legacyEndDate(key: string): string {
	return key.match(/_(\d{4}-\d{2}-\d{2})$/)?.[1] ?? "";
}

export async function findKlineKey(redis: ReturnType<typeof getRedis>, symbol: string): Promise<string | null> {
	const stableKey = `kline:${symbol}`;
	if (await redis.exists(stableKey)) return stableKey;

	let cursor = "0";
	const legacyKeys: string[] = [];
	const pattern = `kline:${symbol}:*`;
	do {
		const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
		cursor = nextCursor;
		legacyKeys.push(...keys);
	} while (cursor !== "0");

	return legacyKeys.sort((left, right) => legacyEndDate(right).localeCompare(legacyEndDate(left)))[0] ?? null;
}

function toErrorResponse(error: unknown): never {
	if (error instanceof MarketDataError) throw error;
	throw new MarketDataError("MARKET_DATA_UNAVAILABLE", "行情数据暂时不可用，请稍后重试", 503);
}

export abstract class MarketDataService {
	static async search(query: string): Promise<StockSearchResult[]> {
		const normalizedQuery = normalizeSearch(query);
		if (!normalizedQuery) return [];

		const redis = getRedis();
		try {
			const stocks = await loadStockUniverse(redis);
			return searchStocks(stocks, normalizedQuery);
		} catch (error) {
			toErrorResponse(error);
		} finally {
			await redis.quit().catch(() => undefined);
		}
	}

	static async getKline(symbol: string): Promise<KlinePayload> {
		const normalizedSymbol = symbol.trim().toLowerCase();
		if (!isMainBoardSymbol(normalizedSymbol)) {
			throw new MarketDataError("INVALID_SYMBOL", "股票代码格式无效", 400);
		}

		const redis = getRedis();
		try {
			const stocks = await loadStockUniverse(redis);
			const stock = stocks.find((item) => item.code === normalizedSymbol);
			if (!stock) throw new MarketDataError("SYMBOL_NOT_FOUND", "股票不在当前主板股票池中", 404);

			const key = await findKlineKey(redis, normalizedSymbol);
			if (!key) throw new MarketDataError("KLINE_NOT_FOUND", "暂无该股票的行情缓存，请先执行数据采集", 404);

			const rows = parseKlineRows(parseJson(await redis.get(key), "股票行情缓存损坏，请重新执行数据采集"), normalizedSymbol);
			if (rows.length === 0) throw new MarketDataError("KLINE_EMPTY", "暂无该股票的有效行情数据", 404);

			const latest = rows[rows.length - 1];
			const previous = rows.length > 1 ? rows[rows.length - 2] : null;
			return {
				symbol: normalizedSymbol,
				name: stock.name,
				bars: rows.map(({ volume: _volume, ...bar }) => bar),
				volume: rows.map(({ time, volume }) => ({ time, value: volume })),
				latest: {
					time: latest.time,
					open: latest.open,
					high: latest.high,
					low: latest.low,
					close: latest.close,
					volume: latest.volume,
					changePercent: previous ? ((latest.close / previous.close) - 1) * 100 : null,
				},
				range: { start: rows[0].time, end: latest.time },
			};
		} catch (error) {
			toErrorResponse(error);
		} finally {
			await redis.quit().catch(() => undefined);
		}
	}
}

export { MarketDataError };
