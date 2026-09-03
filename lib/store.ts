import { promises as fs } from "node:fs";
import path from "node:path";
import type { DB, Snapshot } from "./types";
import { bus } from "./bus";
import { seedDB } from "./seed";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

export const BACKEND: "file" | "supabase" = SUPABASE_URL && SUPABASE_KEY ? "supabase" : "file";

const TABLES = ["projects", "tasks", "activity", "approvals"] as const;
type Table = (typeof TABLES)[number];

interface Backend {
  load(): Promise<DB>;
  save(prev: DB, next: DB): Promise<void>;
}

/* ------------------------------------------------------------------ file */

const fileBackend: Backend = {
  async load() {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<DB>;
      return {
        projects: parsed.projects ?? [],
        tasks: parsed.tasks ?? [],
        activity: parsed.activity ?? [],
        approvals: parsed.approvals ?? [],
      };
    } catch {
      const fresh = seedDB();
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(fresh, null, 2), "utf8");
      return fresh;
    }
  },
  async save(_prev, next) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmp, DATA_FILE);
  },
};

/* -------------------------------------------------------------- supabase */

let supabaseClient: import("@supabase/supabase-js").SupabaseClient | null = null;

async function supabase() {
  if (!supabaseClient) {
    const { createClient } = await import("@supabase/supabase-js");
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  }
  return supabaseClient;
}

/** camelCase in the app, snake_case in Postgres. */
const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const mapKeys = (row: Record<string, unknown>, fn: (k: string) => string) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [fn(k), v]));

const supabaseBackend: Backend = {
  async load() {
    const sb = await supabase();
    const db: DB = { projects: [], tasks: [], activity: [], approvals: [] };
    for (const table of TABLES) {
      const { data, error } = await sb.from(table).select("*");
      if (error) throw new Error(`supabase load ${table}: ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)[table] = (data ?? []).map((r) => mapKeys(r as Record<string, unknown>, toCamel));
    }
    if (db.projects.length === 0) {
      const fresh = seedDB();
      await supabaseBackend.save(db, fresh);
      return fresh;
    }
    return db;
  },

  async save(prev, next) {
    const sb = await supabase();
    for (const table of TABLES) {
      const before = prev[table] as { id: string }[];
      const after = next[table] as { id: string }[];
      const beforeById = new Map(before.map((r) => [r.id, JSON.stringify(r)]));
      const afterIds = new Set(after.map((r) => r.id));

      const changed = after.filter((r) => beforeById.get(r.id) !== JSON.stringify(r));
      const removed = before.filter((r) => !afterIds.has(r.id)).map((r) => r.id);

      if (changed.length) {
        const rows = changed.map((r) => mapKeys(r as Record<string, unknown>, toSnake));
        const { error } = await sb.from(table).upsert(rows);
        if (error) throw new Error(`supabase upsert ${table}: ${error.message}`);
      }
      if (removed.length) {
        const { error } = await sb.from(table).delete().in("id", removed);
        if (error) throw new Error(`supabase delete ${table}: ${error.message}`);
      }
    }
  },
};

const backend: Backend = BACKEND === "supabase" ? supabaseBackend : fileBackend;

/* ----------------------------------------------------------------- cache */

interface Cell {
  db: DB | null;
  rev: number;
  queue: Promise<unknown>;
}

const g = globalThis as unknown as { __handoffStore?: Cell };
const cell: Cell = (g.__handoffStore ??= { db: null, rev: 0, queue: Promise.resolve() });

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Runs `fn` after every previously queued write, so mutations never interleave. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = cell.queue.then(fn, fn);
  cell.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensure(): Promise<DB> {
  if (!cell.db) cell.db = await backend.load();
  return cell.db;
}

export async function snapshot(): Promise<Snapshot> {
  const db = await serial(ensure);
  return { ...clone(db), rev: cell.rev, backend: BACKEND };
}

/**
 * Apply `fn` to a private copy of the database, persist it, and notify SSE
 * clients. The copy means a throwing mutation leaves the live state untouched.
 */
export async function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<{ result: T; snapshot: Snapshot }> {
  return serial(async () => {
    const current = await ensure();
    const draft = clone(current);
    const result = await fn(draft);

    // Keep the activity log from growing without bound during a long demo.
    draft.activity = draft.activity.slice(-400);

    await backend.save(current, draft);
    cell.db = draft;
    cell.rev += 1;

    const snap: Snapshot = { ...clone(draft), rev: cell.rev, backend: BACKEND };
    bus.publish(JSON.stringify(snap));
    return { result, snapshot: snap };
  });
}

/** Wipe back to the demo seed. Used by the Reset button and `/api/seed`. */
export async function reset(): Promise<Snapshot> {
  const { snapshot: snap } = await mutate((db) => {
    const fresh = seedDB();
    db.projects = fresh.projects;
    db.tasks = fresh.tasks;
    db.activity = fresh.activity;
    db.approvals = fresh.approvals;
  });
  return snap;
}
