import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { quantStrategies, watchlists } from "../src/schema";

test("watchlists are unique per user and user assets cascade", () => {
	expect(watchlists).toBeDefined();
	expect(quantStrategies).toBeDefined();
	const migration = readFileSync(
		join(import.meta.dir, "../drizzle/0005_overconfident_cannonball.sql"),
		"utf8",
	);
	expect(migration).toContain('CREATE UNIQUE INDEX "watchlists_user_symbol_unique"');
	expect(migration.match(/ON DELETE cascade/g)?.length).toBe(2);
});

test("auth naming compatibility migration normalizes legacy camelCase columns", () => {
	const migration = readFileSync(
		join(import.meta.dir, "../drizzle/0006_auth_column_naming_compatibility.sql"),
		"utf8",
	);
	expect(migration).toContain('column_name = \'emailVerified\'');
	expect(migration).toContain('RENAME COLUMN "emailVerified" TO "email_verified"');
	expect(migration).toContain('table_name = \'session\'');
	expect(migration).toContain('RENAME COLUMN "userId" TO "user_id"');
});
