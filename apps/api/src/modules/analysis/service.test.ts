import { describe, expect, it, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { AnalysisService } from "./service";
import { engineClient } from "../../lib/engine-client";

// Mock the DB and Redis
mock.module("@stock-quant/database", () => ({
	db: {
		insert: mock().mockReturnValue({
			values: mock().mockReturnValue({
				returning: mock().mockResolvedValue([{ id: "task-123" }]),
			}),
		}),
		update: mock().mockReturnValue({
			set: mock().mockReturnValue({
				where: mock().mockResolvedValue(true),
			}),
		}),
		select: mock().mockReturnValue({
			from: mock().mockReturnValue({
				where: mock().mockReturnValue({
					orderBy: mock().mockReturnValue({
						limit: mock().mockResolvedValue([]),
					}),
					// For userConfigs
					mockResolvedValue: [],
				}),
			}),
		}),
	},
	alphaTasks: { id: "alphaTasks.id" },
	alphaFactors: { userId: "alphaFactors.userId", icValue: "alphaFactors.icValue" },
	userConfigs: { userId: "userConfigs.userId" },
}));

import Redis from "ioredis";

// Mock the DB
mock.module("@stock-quant/database", () => ({
	db: {
		insert: mock().mockReturnValue({
			values: mock().mockReturnValue({
				returning: mock().mockResolvedValue([{ id: "task-123" }]),
			}),
		}),
		update: mock().mockReturnValue({
			set: mock().mockReturnValue({
				where: mock().mockResolvedValue(true),
			}),
		}),
		select: mock().mockReturnValue({
			from: mock().mockReturnValue({
				where: mock().mockReturnValue({
					orderBy: mock().mockReturnValue({
						limit: mock().mockResolvedValue([]),
					}),
					// For userConfigs
					mockResolvedValue: [],
				}),
			}),
		}),
	},
	alphaTasks: { id: "alphaTasks.id" },
	alphaFactors: { userId: "alphaFactors.userId", icValue: "alphaFactors.icValue" },
	userConfigs: { userId: "userConfigs.userId" },
}));

describe("AnalysisService", () => {
	let origGet: any;
	let origSubscribe: any;
	let forceUncached = false;

	afterEach(() => {
		Redis.prototype.get = origGet;
		Redis.prototype.subscribe = origSubscribe;
	});

	beforeEach(() => {
		mock.restore();
		forceUncached = false;
		
		origGet = Redis.prototype.get;
		origSubscribe = Redis.prototype.subscribe;

		Redis.prototype.get = mock(async (key: string) => {
			if (key.includes("market_data")) {
				return forceUncached ? null : "mocked";
			}
			if (key.includes("price_summary")) return JSON.stringify({ symbol: "mock" });
			return null;
		});

		Redis.prototype.subscribe = mock(async function(this: any, channel: string) {
			// Instantly trigger the message event to avoid hanging
			setTimeout(() => {
				this.emit?.("message", channel, "mock_data");
			}, 10);
		}) as any;

		// Avoid real background fetching hanging the test runner
		spyOn(engineClient, "triggerDataFetch").mockResolvedValue(undefined);
		// Mock fetch for LLM call
		global.fetch = mock(async () => {
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: '{"name": "Mock", "overallScore": 99}' } }],
				}),
				{ status: 200 }
			);
		}) as any;
	});

	it("should skip engine data fetch if market data is already in Redis cache", async () => {
		const triggerSpy = spyOn(engineClient, "triggerDataFetch");
		
		await (AnalysisService as any)._runAnalysis(
			"task-123",
			"user-1",
			"sh.cached",
			90
		);

		expect(triggerSpy).not.toHaveBeenCalled();
	});

	it("should call engine triggerDataFetch if market data is missing in Redis cache", async () => {
		forceUncached = true;
		const triggerSpy = spyOn(engineClient, "triggerDataFetch");
		
		await (AnalysisService as any)._runAnalysis(
			"task-123",
			"user-1",
			"sh.uncached",
			90
		);

		expect(triggerSpy).toHaveBeenCalledWith("sh.uncached", 90);
	});
});
