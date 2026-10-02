import { createClient } from "@libsql/client";
async function main() {
  const db = createClient({ url: "file:./dev.db" });
  const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  console.log("TABLES:", tables.rows.map((r:any)=>String(r.name)).join(", "));
  for (const t of tables.rows) {
    const n = (await db.execute(`SELECT COUNT(*) AS c FROM "${String((t as any).name)}"`)).rows[0] as any;
    console.log(String((t as any).name), "=", n.c);
  }
  db.close();
}
main();
