import { expect, test } from "bun:test";
import { config } from "dotenv";
config({ path: "../../.env" });

test("API reads REDIS_URL and DATABASE_URL from root .env", () => {
    expect(process.env.REDIS_URL).toBe("redis://localhost:6379");
    expect(process.env.DATABASE_URL).toBe("postgresql://postgres:postgres@localhost:5432/stock_quant");
});
