import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required; configure it in the repository root .env");
}

export default defineConfig({
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  }
});
