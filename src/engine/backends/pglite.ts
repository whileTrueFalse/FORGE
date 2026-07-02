// In-process Postgres sandbox backend — real Postgres (WASM) via pglite, exposed
// over a local PG-wire socket so the target app's `pg` client connects
// unchanged. No Docker, no binary download. See docs/09-ENGINE-ARCHITECTURE.md.
//
// Single backend: queries are queued (serialized) at the pglite level, which is
// fine at sampled simulation scale. Use the Docker backend for real concurrency.

import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { buildSeedSql } from "./postgres.js";
import type { DbBackend } from "../types.js";
import type { DbSchema } from "../../types.js";

/** Grab a free ephemeral port on loopback. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export async function startPglite(): Promise<DbBackend> {
  const db = await PGlite.create();
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 });
  await server.start();

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

  return {
    connectionString: () => connectionString,
    async seed(schema: DbSchema, totalRows: number): Promise<void> {
      const rowsPerTable = Math.max(50, Math.round(totalRows / Math.max(1, schema.tables.length) / 50));
      await db.exec(buildSeedSql(schema, rowsPerTable));
    },
    async teardown(): Promise<void> {
      await server.stop().catch(() => {});
      await db.close().catch(() => {});
    },
  };
}
