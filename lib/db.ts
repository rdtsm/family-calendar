/**
 * One query interface, two backends speaking the same SQLite dialect:
 *   on Cloudflare  -> the D1 binding
 *   everywhere else -> node:sqlite against a local file
 *
 * Because both are SQLite, local development and production run identical SQL —
 * there is no dialect to diverge. `npm run dev` needs no database installed and
 * no container running.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type Row = Record<string, unknown>;
type Backend = { query: (text: string, params: unknown[]) => Promise<Row[]> };

const g = globalThis as unknown as { __fcBackend?: Promise<Backend> };

type D1Like = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => { all: () => Promise<{ results?: Row[] }> };
    all: () => Promise<{ results?: Row[] }>;
  };
};

/** The D1 binding, when running on Workers. Absent locally, where node:sqlite takes over. */
async function d1Binding(): Promise<D1Like | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    return (env?.DB as D1Like | undefined) ?? null;
  } catch {
    return null;
  }
}

function d1Backend(db: D1Like): Backend {
  return {
    query: async (text, params) => {
      const stmt = db.prepare(text);
      const result = params.length ? await stmt.bind(...params).all() : await stmt.all();
      return result.results ?? [];
    },
  };
}

async function localBackend(): Promise<Backend> {
  const { DatabaseSync } = await import("node:sqlite");
  const file = process.env.SQLITE_PATH || ".data/family.sqlite";
  const resolved = path.resolve(file);

  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new DatabaseSync(resolved);
  db.exec("pragma foreign_keys = ON");
  db.exec(readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8"));

  return {
    // node:sqlite hands back null-prototype objects, which React Server Components
    // refuse to serialise across the client boundary. D1 returns plain objects, so
    // copying here keeps the two backends behaviourally identical.
    query: async (text, params) =>
      (db.prepare(text).all(...(params as never[])) as Row[]).map((row) => ({ ...row })),
  };
}

async function pick(): Promise<Backend> {
  const binding = await d1Binding();
  return binding ? d1Backend(binding) : localBackend();
}

function backend(): Promise<Backend> {
  if (!g.__fcBackend) g.__fcBackend = pick();
  return g.__fcBackend;
}

/** Tagged template: sql`select * from t where id = ${id}` -> rows. */
export async function sql<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? "?" : ""), "");
  return (await backend()).query(text, values) as Promise<T[]>;
}

/** For statements the tagged template cannot express, such as a variable-length VALUES list. */
export async function raw<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await backend()).query(text, params) as Promise<T[]>;
}

/** Ids are generated here rather than by the database, so the schema stays portable. */
export function newId(): string {
  return crypto.randomUUID();
}

/** 'child' uses the app and gets push; the two adult roles subscribe to a feed. */
export type Kind = "child" | "participant" | "observer";

/** Who put an activity on the calendar. A child's own entries stay on their screen. */
export type CreatedBy = "parent" | "child";

/**
 * A member of the family. Still called Child because that is the table every
 * foreign key points at; the `kind` decides how they receive their schedule.
 */
export type Child = {
  id: string;
  name: string;
  color: string;
  emoji: string;
  token: string;
  kind: Kind;
  feed_token: string | null;
  last_fetched_at: string | null;
  sort_order: number;
};

export type CalEvent = {
  id: string;
  child_id: string;
  title: string;
  emoji: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  series_id: string | null;
  group_id: string | null;
  created_by: CreatedBy;
  done_at: string | null;
};
