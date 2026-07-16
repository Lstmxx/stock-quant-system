import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
	alphaTasks,
	llmStockSelectionAttempts,
	llmStockSelectionResults,
} from "../src/schema";

describe("LLM stock selection schema", () => {
	test("exports auditable result and attempt tables", () => {
		const resultConfig = getTableConfig(llmStockSelectionResults);
		const attemptConfig = getTableConfig(llmStockSelectionAttempts);

		expect(resultConfig.name).toBe("llm_stock_selection_results");
		expect(attemptConfig.name).toBe("llm_stock_selection_attempts");
		expect(llmStockSelectionResults.candidateSources.notNull).toBe(true);
		expect(llmStockSelectionResults.llmStatus.notNull).toBe(true);
		expect(llmStockSelectionResults.attemptCount.notNull).toBe(true);
		expect(llmStockSelectionResults.selected.notNull).toBe(true);

		const resultIndexes = resultConfig.indexes.map((index) => index.config.name);
		const attemptIndexes = attemptConfig.indexes.map((index) => index.config.name);
		expect(resultIndexes).toContain(
			"llm_stock_selection_results_task_symbol_unique",
		);
		expect(resultIndexes).toContain(
			"llm_stock_selection_results_task_selected_rank_idx",
		);
		expect(attemptIndexes).toContain(
			"llm_stock_selection_attempts_result_attempt_unique",
		);
	});

	test("enforces one active LLM selection task per user", () => {
		const indexNames = getTableConfig(alphaTasks).indexes.map(
			(index) => index.config.name,
		);
		expect(indexNames).toContain(
			"alpha_tasks_active_llm_stock_selection_user_unique",
		);
	});

	test("cascades result and attempt ownership", () => {
		const resultForeignKeys = getTableConfig(llmStockSelectionResults).foreignKeys;
		const attemptForeignKeys = getTableConfig(llmStockSelectionAttempts).foreignKeys;

		expect(resultForeignKeys.every((foreignKey) => foreignKey.onDelete === "cascade")).toBe(true);
		expect(attemptForeignKeys.every((foreignKey) => foreignKey.onDelete === "cascade")).toBe(true);
	});

	test("ships a forward migration for tables and indexes", () => {
		const migrationPath = fileURLToPath(
			new URL(
				"../drizzle/0004_llm_stock_selection_contract.sql",
				import.meta.url,
			),
		);
		const migration = readFileSync(migrationPath, "utf8");

		expect(migration).toContain('CREATE TABLE "llm_stock_selection_results"');
		expect(migration).toContain('CREATE TABLE "llm_stock_selection_attempts"');
		expect(migration).toContain(
			'"alpha_tasks_active_llm_stock_selection_user_unique"',
		);
		expect(migration).toContain(
			'"llm_stock_selection_results_task_symbol_unique"',
		);
	});
});
