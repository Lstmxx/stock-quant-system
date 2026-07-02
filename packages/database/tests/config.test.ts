import { expect, test } from "bun:test";
import { config } from "dotenv";
config({ path: "../../.env" });

test("Database reads DATABASE_URL from root .env", () => {
    expect(process.env.DATABASE_URL).toBe("postgresql://postgres:postgres@localhost:5432/stock_quant");
});
