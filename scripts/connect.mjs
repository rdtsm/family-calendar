/** Same local backend as lib/db.ts, for the CLI scripts. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export function connect() {
  const resolved = path.resolve(process.env.SQLITE_PATH || ".data/family.sqlite");
  mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("pragma foreign_keys = ON");
  return {
    kind: "sqlite",
    query: (text, params = []) => db.prepare(text).all(...params),
    exec: (text) => db.exec(text),
    close: () => db.close(),
  };
}

export function schemaSql() {
  return readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8");
}
