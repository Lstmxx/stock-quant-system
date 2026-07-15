import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import { db } from "@stock-quant/database";
import { LlmService } from "../llm/service";
import { StrategyService } from "./service";


describe("StrategyService LLM convergence", () => {
	afterEach(() => mock.restore());

	it("uses the current user's default model through the Engine contract", async () => {
		const chatSpy = spyOn(LlmService, "chatDefault").mockResolvedValue({
			content: JSON.stringify({ summary: "ok", radarData: [] }),
			provider: "openai",
			model: "openai/gpt-5",
			usage: null,
		});
		spyOn(db, "insert").mockReturnValue({
			values: mock().mockResolvedValue(undefined),
		} as never);

		const result = await StrategyService.generateReportStructured("user-1", {
			style: "Momentum",
			factorId: "factor-123456",
			simulationResult: { annualReturn: 0.12 },
			constraints: { maxDrawdown: 0.2 },
		});

		expect(result.summary).toBe("ok");
		expect(chatSpy).toHaveBeenCalledWith(
			"user-1",
			expect.objectContaining({ jsonMode: true }),
		);
	});
});
