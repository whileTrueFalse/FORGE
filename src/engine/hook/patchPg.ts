// Monkeypatches the `pg` module so every query the target app runs is evaluated
// and enforced before reaching the sandbox database. The actual decision/enforce
// logic lives in intercept.ts (unit-tested); this file is the wiring that
// extracts SQL from a real pg call, runs it through that core, and forwards the
// (possibly rewritten) query to the original implementation.

import { interceptDbQuery, type InterceptDeps } from "./intercept.js";
import type { AgentOperation } from "../../types.js";

let opCounter = 0;

/** Extract the SQL text from pg `query()` args (string form or { text } form). */
export function sqlFromQueryArgs(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && typeof (first as { text?: unknown }).text === "string") {
    return (first as { text: string }).text;
  }
  return "";
}

/** Return a copy of the args with the SQL text replaced (for rewrites). */
function withSql(args: unknown[], sql: string): unknown[] {
  const out = [...args];
  if (typeof out[0] === "string") out[0] = sql;
  else if (out[0] && typeof out[0] === "object") out[0] = { ...(out[0] as object), text: sql };
  return out;
}

interface QueryProto {
  query?: (...args: unknown[]) => unknown;
  __forgePatched?: boolean;
}
interface PgLikeModule {
  Client?: { prototype: QueryProto };
  Pool?: { prototype: QueryProto };
}

/**
 * Wrap `query()` on a pg-like module's Client/Pool prototypes. Exported so it
 * can be unit-tested against a fake module; `installPgPatch` calls it on the
 * real `pg`.
 */
export function patchPgModule(pg: PgLikeModule, deps: InterceptDeps, file = "app"): void {
  for (const ctor of [pg.Client, pg.Pool]) {
    const proto = ctor?.prototype;
    if (!proto || typeof proto.query !== "function" || proto.__forgePatched) continue;
    const original = proto.query;
    proto.query = function patchedQuery(this: unknown, ...args: unknown[]) {
      const sql = sqlFromQueryArgs(args);
      if (!sql) return original.apply(this, args);
      const op: AgentOperation = { id: `pg${++opCounter}`, kind: "db_query", sql, file };
      return interceptDbQuery(op, deps, (newSql) =>
        Promise.resolve(original.apply(this, newSql === sql ? args : withSql(args, newSql)))
      );
    };
    proto.__forgePatched = true;
  }
}

type PgCtor = (new (...args: unknown[]) => unknown) & { __forgeConnForced?: boolean };

/**
 * Force every `pg` Client/Pool to connect to the sandbox, regardless of the
 * host/port/database the app hardcodes. Query interception (patchPgModule) runs
 * ON the connection, so if an app does `new Client({ host: "prod-db" })` its
 * queries would still be enforced but hit the REAL database. Subclassing the
 * constructors and ignoring the app-supplied config closes that bypass: the only
 * database anything can reach is the sandbox. The subclasses inherit the already
 * patched `query`, so enforcement is preserved.
 */
export function forcePgSandboxConnection(pg: PgLikeModule, sandboxUrl: string): void {
  const mod = pg as unknown as Record<string, PgCtor | undefined>;
  for (const key of ["Client", "Pool"] as const) {
    const Original = mod[key];
    if (typeof Original !== "function" || Original.__forgeConnForced) continue;
    const Base = Original as unknown as { new (...a: unknown[]): object };
    const Forced = class extends Base {
      constructor(..._args: unknown[]) {
        // Ignore whatever host/db the app asked for — always the sandbox.
        super({ connectionString: sandboxUrl });
      }
    } as unknown as PgCtor;
    Forced.__forgeConnForced = true;
    mod[key] = Forced;
  }
}

/** Install the patch on the app's real `pg` module (best-effort). When a sandbox
 *  connection string is provided, also force every connection onto it. */
export function installPgPatch(deps: InterceptDeps, sandboxUrl?: string): boolean {
  try {
    // require from the target app's module resolution, not forge's.
    const require = createRequire(process.cwd() + "/");
    const pg = require("pg") as PgLikeModule;
    patchPgModule(pg, deps);
    if (sandboxUrl) forcePgSandboxConnection(pg, sandboxUrl);
    return true;
  } catch {
    return false; // app doesn't use pg, or it isn't resolvable
  }
}

import { createRequire } from "node:module";
