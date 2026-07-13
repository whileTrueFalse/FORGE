// Tests the pure SQL normalizer used by the policy engine to prevent
// comment/string/multi-statement evasion.

import test from "node:test";
import assert from "node:assert/strict";
import { stripSqlComments, blankStringLiterals, splitSqlStatements } from "./sqlNormalize.js";

test("stripSqlComments removes block, --, and # comments", () => {
  assert.equal(stripSqlComments("SELECT/* x */*").replace(/\s+/g, " ").trim(), "SELECT *");
  assert.equal(stripSqlComments("DROP -- nope\nTABLE t").replace(/\s+/g, " ").trim(), "DROP TABLE t");
  assert.equal(stripSqlComments("UPDATE t SET x=1 # c").trim(), "UPDATE t SET x=1");
});

test("blankStringLiterals blanks contents, keeps quotes + length", () => {
  const a = blankStringLiterals("SET note='where id=1'");
  assert.match(a, /^SET note='\s+'$/);
  assert.ok(!/where/i.test(a), "keyword inside the string must not survive");
  assert.equal(a.length, "SET note='where id=1'".length);
  // doubled-quote escape ('') stays inside the string, still blanked
  const b = blankStringLiterals("a='it''s'");
  assert.match(b, /^a='\s+'$/);
  assert.equal(b.length, "a='it''s'".length);
});

test("splitSqlStatements splits top-level, ignores ; in strings/comments", () => {
  assert.deepEqual(splitSqlStatements("SELECT 1; SELECT 2"), ["SELECT 1", "SELECT 2"]);
  const s = splitSqlStatements("SELECT ';'"); // ; inside string must not split
  assert.equal(s.length, 1);
  assert.ok(!s[0].includes(";"));
  assert.deepEqual(splitSqlStatements("SELECT 1 -- ; comment\n"), ["SELECT 1"]);
  assert.deepEqual(splitSqlStatements("  ;  "), []);
});
