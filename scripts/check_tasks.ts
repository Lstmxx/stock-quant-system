import { db, alphaTasks } from "../packages/database/src";

async function main() {
  const all = await db.select().from(alphaTasks);
  console.log("All tasks:", all.map(t => ({ id: t.id, type: t.type, status: t.status })));
  process.exit(0);
}

main();
