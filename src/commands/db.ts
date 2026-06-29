// `forge db link` — see docs/05-CLI-UX-SPEC.md.

import ora from "ora";
import * as ui from "../core/ui.js";
import { loadForgeYaml, saveForgeYaml, saveSchema, loadSchema, ensureForgeDirs } from "../core/store.js";
import { detectDbType, generateSchema, generateSyntheticRows, totalIndexes } from "../core/simDb.js";
import type { DbConnectorConfig, DbSchema } from "../types.js";

interface DbLinkOptions {
  simOnly?: boolean;
  rows?: string;
}

export async function dbLink(connectionString: string, options: DbLinkOptions): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  ensureForgeDirs();

  console.log();
  ui.dim(`  reading schema from ${connectionString}...`);
  await ui.sleep(400);

  const schema = generateSchema(connectionString);
  const indexCount = totalIndexes(schema);
  ui.ok(`${schema.tables.length} tables, ${indexCount} indexes detected`);

  saveSchema(schema);
  ui.ok("schema snapshot saved → .forge/schema.json");

  // v0 never copies real data — sim-only is the only supported mode. The
  // `--sim-only` flag is accepted for forward-compat but is always in effect.
  ui.warn("no prod data copied — sim engine will generate synthetic rows");

  const totalRows = options.rows ? Number(options.rows) : 50000;
  console.log();
  const spinner = ora(`generating ${totalRows.toLocaleString()} synthetic rows matching schema distributions...`).start();
  await ui.sleep(700);
  const rowCounts = generateSyntheticRows(schema, totalRows);
  spinner.stop();

  ui.ok(`sim database ready → forge-sim://${config.project}`);

  const dbType = detectDbType(connectionString);
  const dbConfig: DbConnectorConfig = {
    name: "primary",
    type: dbType,
    schema_from: connectionString,
    sim_rows: rowCounts.totalRows,
    distributions: "auto",
    linked_at: new Date().toISOString(),
  };

  config.data.databases = config.data.databases.filter((d) => d.name !== "primary");
  config.data.databases.push(dbConfig);
  saveForgeYaml(config);
}

export async function dbStatus(): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  console.log();
  if (config.data.databases.length === 0) {
    ui.dim("  no database linked — run `forge db link <connection-string>`");
    return;
  }

  for (const db of config.data.databases) {
    ui.ok(`${db.name} (${db.type}) · ${db.sim_rows.toLocaleString()} sim rows`);
    ui.dim(`  schema_from: ${db.schema_from}`);
    ui.dim(`  linked_at:   ${db.linked_at}`);
  }

  const schema = loadSchema<DbSchema>();
  if (schema) {
    const indexCount = totalIndexes(schema);
    console.log();
    ui.dim(`  schema snapshot: ${schema.tables.length} tables, ${indexCount} indexes`);
    for (const table of schema.tables) {
      const pii = table.columns.filter((c) => c.pii).map((c) => c.name);
      const piiNote = pii.length > 0 ? ` (pii: ${pii.join(", ")})` : "";
      ui.dim(`    ${table.name} — ${table.columns.length} cols, ${table.indexes} idx${piiNote}`);
    }
  }
}
