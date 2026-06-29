// Tests the pure seed-SQL builder (no Docker). The live container lifecycle is
// exercised only in a real `forge run --real` on a machine with Docker.

import test from "node:test";
import assert from "node:assert/strict";
import { buildSeedSql } from "./postgres.js";
import { FIXED_SCHEMA } from "../../core/simDb.js";

test("buildSeedSql: emits DDL + seed inserts for every table", () => {
  const sql = buildSeedSql(FIXED_SCHEMA, 100);
  for (const t of FIXED_SCHEMA.tables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t.name}`));
    assert.match(sql, new RegExp(`INSERT INTO ${t.name}`));
  }
  assert.match(sql, /generate_series\(1, 100\)/);
});

test("buildSeedSql: maps column types and pii columns to text", () => {
  const sql = buildSeedSql(FIXED_SCHEMA, 10);
  assert.match(sql, /id uuid/);
  assert.match(sql, /email text/); // pii column still a real column
  assert.match(sql, /total numeric/);
  assert.match(sql, /created_at timestamptz/);
});
