import { expect, test } from "bun:test";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv, ROOT_ENV_FILE, redisUrl } from "../src/lib/env";

test("API reads REDIS_URL and DATABASE_URL from root .env", () => {
	expect(basename(ROOT_ENV_FILE)).toBe(".env");
	expect(dirname(ROOT_ENV_FILE)).toBe(
		resolve(fileURLToPath(new URL("../../../", import.meta.url))),
	);

	const redis = new URL(redisUrl);
	expect(["redis:", "rediss:"]).toContain(redis.protocol);
	expect(redis.hostname.length).toBeGreaterThan(0);

	const database = new URL(requireEnv("DATABASE_URL"));
	expect(["postgres:", "postgresql:"]).toContain(database.protocol);
	expect(database.hostname.length).toBeGreaterThan(0);
	expect(database.pathname.length).toBeGreaterThan(1);
});
