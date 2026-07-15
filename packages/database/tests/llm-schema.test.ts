import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";

import { llmModels, userConfigs } from "../src/schema";

describe("LLM configuration schema", () => {
	test("enforces one default model and one config key per user", () => {
		const llmConfig = getTableConfig(llmModels);
		const llmIndexNames = llmConfig.indexes.map((index) => index.config.name);
		const userConfigIndexNames = getTableConfig(userConfigs).indexes.map(
			(index) => index.config.name,
		);

		expect(llmModels.isDefault.notNull).toBe(true);
		expect(llmIndexNames).toContain("llm_models_user_default_unique");
		expect(llmIndexNames).toContain("llm_models_user_created_idx");
		expect(userConfigIndexNames).toContain("user_configs_user_key_unique");
	});

	test("cascades models when their owning user is deleted", () => {
		const foreignKey = getTableConfig(llmModels).foreignKeys.find(
			(candidate) => candidate.reference().columns[0] === llmModels.userId,
		);

		expect(foreignKey?.onDelete).toBe("cascade");
	});

	test("ships a forward migration for the table and constraints", () => {
		const migrationPath = fileURLToPath(
			new URL("../drizzle/0003_llm_configuration_contract.sql", import.meta.url),
		);
		const migration = readFileSync(migrationPath, "utf8");

		expect(migration).toContain('CREATE TABLE IF NOT EXISTS "llm_models"');
		expect(migration).toContain('"isDefault" boolean DEFAULT false NOT NULL');
		expect(migration).toContain('"llm_models_user_default_unique"');
		expect(migration).toContain('WHERE "isDefault" = true');
		expect(migration).toContain('"user_configs_user_key_unique"');
	});
});
