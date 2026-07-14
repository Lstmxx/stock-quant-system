import { config } from "dotenv";
import { fileURLToPath } from "node:url";

export const ROOT_ENV_FILE = fileURLToPath(
	new URL("../../../../.env", import.meta.url),
);

config({ path: ROOT_ENV_FILE });

export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required; configure it in the repository root .env`);
	}
	return value;
}

export const redisUrl = requireEnv("REDIS_URL");
