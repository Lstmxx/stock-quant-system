import { describe, expect, it } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

import { alphaTasks, dataCollectionConfigs } from "../src/schema";

describe("data collection schema", () => {
	it("stores one global collection configuration", () => {
		expect(dataCollectionConfigs.scope.notNull).toBe(true);
		expect(dataCollectionConfigs.cronExpression.notNull).toBe(true);
		expect(dataCollectionConfigs.updatedBy.notNull).toBe(false);

		const indexNames = getTableConfig(dataCollectionConfigs).indexes.map(
			(index) => index.config.name,
		);
		expect(indexNames).toContain("data_collection_configs_scope_unique");
	});

	it("allows scheduled tasks without a user and protects the active slot", () => {
		expect(alphaTasks.userId.notNull).toBe(false);

		const activeIndex = getTableConfig(alphaTasks).indexes.find(
			(index) =>
				index.config.name === "alpha_tasks_active_data_collection_unique",
		);
		expect(activeIndex).toBeDefined();
		expect(activeIndex?.config.unique).toBe(true);
		expect(activeIndex?.config.where).toBeDefined();
	});
});
