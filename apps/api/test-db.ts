import "./src/lib/env";
import { db, userConfigs } from "@stock-quant/database";
import { eq } from "drizzle-orm";

async function main() {
    try {
        await db.select().from(userConfigs).where(eq(userConfigs.key, "BAOSTOCK_CRON"));
        console.log("Success");
    } catch {
        console.error("Database connectivity check failed");
        process.exit(1);
    }
    process.exit(0);
}
main();
