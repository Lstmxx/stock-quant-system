import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: "../../.env" });

export default defineConfig({
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://postgres:password@localhost:5432/stock_quant"
  }
});
