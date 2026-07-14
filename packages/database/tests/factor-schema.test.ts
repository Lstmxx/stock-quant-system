import { describe, expect, it } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
	alphaFactors,
	factorSelectionResults,
	userSelectedFactors,
} from "../src/schema";

describe("factor schema", () => {
	it("uses numeric metrics and a user-scoped expression constraint", () => {
		expect(alphaFactors.icValue.getSQLType()).toBe("double precision");
		expect(alphaFactors.icir.getSQLType()).toBe("double precision");
		expect(alphaFactors.monotonicity.getSQLType()).toBe("double precision");
		expect(alphaFactors.direction.getSQLType()).toBe("integer");
		expect(alphaFactors.generation.getSQLType()).toBe("integer");

		const indexNames = getTableConfig(alphaFactors).indexes.map(
			(index) => index.config.name,
		);
		expect(indexNames).toContain("alpha_factors_user_expression_unique");
	});

	it("exports selection configuration and per-stock task results", () => {
		expect(getTableConfig(userSelectedFactors).name).toBe(
			"user_selected_factors",
		);
		expect(getTableConfig(factorSelectionResults).name).toBe(
			"factor_selection_results",
		);
		expect(factorSelectionResults.compositeScore.getSQLType()).toBe(
			"double precision",
		);
	});
});
