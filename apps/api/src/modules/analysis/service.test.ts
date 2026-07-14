import { describe, expect, it } from "bun:test";

import { buildAnalysisPrompt } from "./service";

describe("buildAnalysisPrompt", () => {
	it("includes the persisted stock exposure instead of factor definitions only", () => {
		const prompt = buildAnalysisPrompt(
			"sh.600000",
			{ close: 10.2 },
			{
				selectionTaskId: "selection-1",
				dataDate: "2026-07-10",
				universeType: "ALL_MARKET",
				symbol: "sh.600000",
				compositeScore: 1.25,
				rank: 3,
				factorContributions: [
					{
						factorId: "factor-1",
						name: "Momentum",
						value: 12.3,
						zScore: 1.1,
						weight: 0.4,
						direction: 1,
						contribution: 0.44,
						percentile: 92,
					},
				],
			},
		);

		expect(prompt).toContain('"value": 12.3');
		expect(prompt).toContain('"percentile": 92');
		expect(prompt).toContain('"rank": 3');
		expect(prompt).toContain('"selectionTaskId": "selection-1"');
	});
});
