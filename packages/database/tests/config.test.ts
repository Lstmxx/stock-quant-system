import { expect, test } from "bun:test";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

const rootEnvFile = fileURLToPath(new URL("../../../.env", import.meta.url));

test("repository root environment provides a valid DATABASE_URL", () => {
	const loaded = config({ path: rootEnvFile });
	expect(loaded.error).toBeUndefined();

	const databaseUrl = process.env.DATABASE_URL;
	expect(databaseUrl).toBeDefined();
	const parsed = new URL(databaseUrl as string);
	expect(["postgres:", "postgresql:"]).toContain(parsed.protocol);
	expect(parsed.hostname.length).toBeGreaterThan(0);
	expect(parsed.pathname.length).toBeGreaterThan(1);
});
