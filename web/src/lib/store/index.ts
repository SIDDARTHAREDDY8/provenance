import { FileStore } from "./file-store";
import { PostgresStore } from "./postgres-store";
import type { Store } from "./types";

export type { Store, StoredAssessment } from "./types";

/**
 * Pinned to globalThis: the file driver keeps an in-process cache, and Next can
 * instantiate a module more than once per process across its bundles. Two
 * caches over one directory is a stale-read bug waiting for a demo.
 */
const KEY = Symbol.for("provenance.store");
type Global = typeof globalThis & { [KEY]?: Store };

export function store(): Store {
  const g = globalThis as Global;
  if (g[KEY]) return g[KEY];
  const url = process.env.DATABASE_URL;
  g[KEY] = url && url.trim().length > 0 ? new PostgresStore(url) : new FileStore();
  return g[KEY];
}
