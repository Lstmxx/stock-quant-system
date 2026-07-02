import { expect, test } from "bun:test";
import { resolve } from "path";
import { loadEnv } from "vite";
import config from "../vite.config";

test("Web Vite config has correct envDir", () => {
    // Check if envDir is set to point to the root directory
    expect(config.envDir).toBe("../../");
});

test("Vite loadEnv can load VITE_API_URL from root .env", () => {
    // Load env using the configured envDir, resolving relative to the vite.config.ts location (..)
    const env = loadEnv("development", resolve(__dirname, "../", config.envDir || ""), "");
    expect(env.VITE_API_URL).toBe("http://localhost:3000");
});
