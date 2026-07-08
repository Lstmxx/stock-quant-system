import postgres from "postgres";

async function main() {
    const sql = postgres("postgresql://postgres:password@localhost:5432/stock_quant");
    try {
        const result = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'user_configs';`;
        console.log(result);
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
main();
