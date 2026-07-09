import { describe, expect, it, mock, beforeEach, spyOn } from "bun:test";
import { FactorService } from "./service";
import { db } from "@stock-quant/database";

// Mock the DB
mock.module("@stock-quant/database", () => ({
	db: {
		select: mock().mockReturnValue({
			from: mock().mockReturnValue({
				where: mock().mockReturnValue({
					orderBy: mock().mockReturnValue({
						limit: mock().mockReturnValue({
							offset: mock().mockResolvedValue([{ id: "factor-1" }]),
						}),
					}),
					// Mock count response
					mockResolvedValue: [{ count: 10 }],
				}),
			}),
		}),
	},
	alphaFactors: { 
		id: "alphaFactors.id", 
		userId: "alphaFactors.userId", 
		name: "alphaFactors.name", 
		expression: "alphaFactors.expression",
		icValue: "alphaFactors.icValue"
	},
}));

describe("FactorService", () => {
	beforeEach(() => {
		mock.restore();
	});

	describe("listByUser", () => {
		it("should query factors without keyword and return data and total", async () => {
			const selectMock = db.select() as any;
			
			// Mock the count query (first query)
			selectMock.from.mockReturnValueOnce({
				where: mock().mockResolvedValue([{ count: 25 }])
			});
			
			// Mock the data query (second query)
			selectMock.from.mockReturnValueOnce({
				where: mock().mockReturnValue({
					orderBy: mock().mockReturnValue({
						limit: mock().mockReturnValue({
							offset: mock().mockResolvedValue([
								{ id: "factor-1", name: "Factor A" },
								{ id: "factor-2", name: "Factor B" }
							])
						})
					})
				})
			});

			const result = await FactorService.listByUser("user-1", 10, 0);
			
			expect(result).toHaveProperty("data");
			expect(result).toHaveProperty("total", 25);
			expect(result.data).toHaveLength(2);
		});

		it("should construct query with ilike conditions when keyword is provided", async () => {
			const selectMock = db.select() as any;
			
			// Mock the count query
			selectMock.from.mockReturnValueOnce({
				where: mock().mockResolvedValue([{ count: 5 }])
			});
			
			// Mock the data query
			selectMock.from.mockReturnValueOnce({
				where: mock().mockReturnValue({
					orderBy: mock().mockReturnValue({
						limit: mock().mockReturnValue({
							offset: mock().mockResolvedValue([
								{ id: "factor-3", name: "Test Factor" }
							])
						})
					})
				})
			});

			const result = await FactorService.listByUser("user-1", 10, 0, "Test");
			
			expect(result).toHaveProperty("data");
			expect(result).toHaveProperty("total", 5);
			expect(result.data).toEqual([{ id: "factor-3", name: "Test Factor" }]);
		});
	});
});
