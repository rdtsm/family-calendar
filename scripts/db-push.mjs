import { connect, schemaSql } from "./connect.mjs";

const db = connect();
db.exec(schemaSql());
const tables = db.query("select name from sqlite_master where type='table' order by name");
console.log(`Schema applied to ${db.kind}: ${tables.map((t) => t.name).join(", ")}`);
db.close();
