import { config } from "dotenv";
config({ path: "../../.env" });
import { db, userConfigs } from "@stock-quant/database";
import { eq } from "drizzle-orm";

async function main() {
    try {
        await db.select().from(userConfigs).where(eq(userConfigs.key, "BAOSTOCK_CRON"));
        console.log("Success");
    } catch(e) {
        console.error("Actual error message:", e.message);
        console.error("Detail:", e.detail || e.cause?.message || e);
    }
    process.exit(0);
}
main();
