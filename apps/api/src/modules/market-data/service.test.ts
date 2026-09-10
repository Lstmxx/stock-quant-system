import { describe, expect, it } from "bun:test";
import {
	findKlineKey,
	isMainBoardSymbol,
	parseKlineRows,
	searchStocks,
} from "./service";

describe("market data service", () => {
	const symbol = "sh.600519";

	it("deduplicates dates and keeps the latest row in ascending order", () => {
		const rows = parseKlineRows([
			["2026-08-27", symbol, "1500", "1520", "1490", "1510", "1200"],
			["2026-08-26", symbol, 1480, 1500, 1470, 1495, 1100],
			["2026-08-27", symbol, 1501, 1521, 1491, 1512, 1300],
			["2026-08-25", "sz.000001", 10, 11, 9, 10.5, 900],
		], symbol);

		expect(rows).toEqual([
			{ time: "2026-08-26", open: 1480, high: 1500, low: 1470, close: 1495, volume: 1100 },
			{ time: "2026-08-27", open: 1501, high: 1521, low: 1491, close: 1512, volume: 1300 },
		]);
	});

	it("ignores malformed rows instead of passing invalid points to the chart", () => {
		const rows = parseKlineRows([
			["not-a-date", symbol, 1, 1, 1, 1, 1],
			["2026-08-27", symbol, "bad", 1, 1, 1, 1],
			["2026-08-26", symbol, 1, 1, 1, 0, 1],
		], symbol);

		expect(rows).toEqual([]);
	});

	it("normalizes date values to strings", () => {
		const rows = parseKlineRows([
			[new Date("2026-08-27T00:00:00.000Z"), symbol, 1, 1, 1, 1, 1],
			[new Date("2026-08-26T00:00:00.000Z"), symbol, 1, 1, 1, 1, 1],
		], symbol);

		expect(rows).toEqual([
			{ time: "2026-08-26", open: 1, high: 1, low: 1, close: 1, volume: 1 },
			{ time: "2026-08-27", open: 1, high: 1, low: 1, close: 1, volume: 1 },
		]);
		expect(rows.every((row) => typeof row.time === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.time))).toBe(true);
	});

	it("ranks exact code matches ahead of name and fuzzy matches", () => {
		const stocks = [
			{ code: "sh.600519", name: "贵州茅台" },
			{ code: "sh.600518", name: "康美药业" },
			{ code: "sz.000519", name: "茅台相关" },
		];

		expect(searchStocks(stocks, "600519")).toEqual([stocks[0]]);
		expect(searchStocks(stocks, "6005")).toEqual([stocks[1], stocks[0]]);
		expect(searchStocks(stocks, "贵州")).toEqual([stocks[0]]);
	});

	it("accepts only main-board symbols", () => {
		expect(isMainBoardSymbol("sh.600519")).toBe(true);
		expect(isMainBoardSymbol("sz.000001")).toBe(true);
		expect(isMainBoardSymbol("sz.300001")).toBe(false);
		expect(isMainBoardSymbol("600519.SH")).toBe(false);
	});

	it("prefers the stable cache and selects the newest legacy key", async () => {
		const redis = {
			exists: async (key: string) => key === "kline:sh.600519",
			scan: async () => ["0", []],
		} as unknown as ReturnType<typeof import("../task/service").getRedis>;
		expect(await findKlineKey(redis, symbol)).toBe("kline:sh.600519");

		const legacyRedis = {
			exists: async () => 0,
			scan: async (cursor: string) => cursor === "0"
				? ["1", ["kline:sh.600519:2026-01-01_2026-08-26"]]
				: ["0", ["kline:sh.600519:2026-01-01_2026-08-27"]],
		} as unknown as ReturnType<typeof import("../task/service").getRedis>;
		expect(await findKlineKey(legacyRedis, symbol)).toBe("kline:sh.600519:2026-01-01_2026-08-27");
	});
});
