// Dockerized Postgres sandbox backend. Spins an ephemeral postgres:16 container,
// seeds it from the captured schema, hands the orchestrator a connection string,
// and tears down on teardown. Requires Docker on the machine — the only piece of
// the engine that does. See docs/09-ENGINE-ARCHITECTURE.md §7.1.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { DbBackend } from "../types.js";
import type { DbSchema } from "../../types.js";

const exec = promisify(execFile);

const IMAGE = "postgres:16-alpine";
const PG_USER = "forge";
const PG_PASS = "forge";
const PG_DB = "forge";

export async function dockerAvailable(): Promise<boolean> {
  try {
    await exec("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

function pgType(t: string): string {
  switch (t) {
    case "uuid": return "uuid";
    case "integer": return "integer";
    case "numeric": return "numeric";
    case "timestamp": return "timestamptz";
    default: return "text";
  }
}
function pgValue(t: string): string {
  switch (t) {
    case "uuid": return "gen_random_uuid()";
    case "integer": return "g";
    case "numeric": return "round((g * 1.5)::numeric, 2)";
    case "timestamp": return "now()";
    default: return "('val_' || g)";
  }
}

/** Build DDL + synthetic-row INSERTs for the schema. Pure — unit-testable.
 *  Uses only core Postgres (gen_random_uuid is core since PG 13), so the same
 *  SQL seeds both the Docker backend and the in-process pglite backend. */
export function buildSeedSql(schema: DbSchema, rowsPerTable = 250): string {
  const parts: string[] = [];
  for (const t of schema.tables) {
    const cols = t.columns.map((c) => `${c.name} ${pgType(c.type)}`).join(", ");
    parts.push(`CREATE TABLE IF NOT EXISTS ${t.name} (${cols});`);
    const colNames = t.columns.map((c) => c.name).join(", ");
    const vals = t.columns.map((c) => pgValue(c.type)).join(", ");
    parts.push(`INSERT INTO ${t.name} (${colNames}) SELECT ${vals} FROM generate_series(1, ${rowsPerTable}) g;`);
  }
  return parts.join("\n");
}

async function waitReady(containerId: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await exec("docker", ["exec", containerId, "pg_isready", "-U", PG_USER]);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("sandbox postgres did not become ready in time");
}

export async function startPostgres(): Promise<DbBackend & { containerId: string }> {
  const { stdout } = await exec("docker", [
    "run", "-d", "--rm",
    "-e", `POSTGRES_USER=${PG_USER}`,
    "-e", `POSTGRES_PASSWORD=${PG_PASS}`,
    "-e", `POSTGRES_DB=${PG_DB}`,
    "-p", "127.0.0.1::5432",
    IMAGE,
  ]);
  const containerId = stdout.trim();

  // Resolve the ephemeral host port Docker assigned.
  const { stdout: portOut } = await exec("docker", ["port", containerId, "5432"]);
  const port = Number(portOut.trim().split(":").pop());

  await waitReady(containerId);

  const connectionString = `postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${port}/${PG_DB}`;

  return {
    containerId,
    connectionString: () => connectionString,
    async seed(schema: DbSchema, totalRows: number): Promise<void> {
      const rowsPerTable = Math.max(50, Math.round(totalRows / Math.max(1, schema.tables.length) / 50));
      const sql = buildSeedSql(schema, rowsPerTable);
      await new Promise<void>((resolve, reject) => {
        const psql = spawn("docker", ["exec", "-i", containerId, "psql", "-U", PG_USER, "-d", PG_DB], { stdio: ["pipe", "ignore", "inherit"] });
        psql.on("error", reject);
        psql.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`psql exited ${code}`))));
        psql.stdin.end(sql);
      });
    },
    async teardown(): Promise<void> {
      try {
        await exec("docker", ["rm", "-f", containerId]);
      } catch {
        /* already gone */
      }
    },
  };
}
