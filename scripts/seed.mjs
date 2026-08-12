import { connect, schemaSql } from "./connect.mjs";

const db = connect();
db.exec(schemaSql());

const [{ n }] = db.query("select count(*) as n from children");
if (n > 0) {
  console.log("Children already exist — nothing to seed.");
} else {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");
  db.query("insert into children (id, name, emoji, color, token, sort_order) values (?, ?, ?, ?, ?, 0)", [
    crypto.randomUUID(),
    "Beatrix",
    "🦊",
    "violet",
    token,
  ]);
  console.log("Seeded Beatrix.");
}

for (const c of db.query("select name, token from children order by sort_order")) {
  console.log(`  ${c.name}: /k/${c.token}`);
}
db.close();
