// Fake schema introspection + synthetic row generation.
// See docs/02-ARCHITECTURE.md and docs/05-CLI-UX-SPEC.md for the expected
// table/index counts referenced in `forge db link` output.

import type { DbSchema, DbTable, RowCounts } from "../types.js";

/**
 * Fixed e-commerce-shaped schema used to stand in for real schema
 * introspection in v0. Keep this as the single source of truth for table/
 * column/index counts so CLI output stays consistent with reality.
 */
export const FIXED_SCHEMA: DbSchema = {
  tables: [
    {
      name: "users",
      indexes: 3,
      columns: [
        { name: "id", type: "uuid" },
        { name: "email", type: "text", pii: true },
        { name: "phone", type: "text", pii: true },
        { name: "address", type: "text", pii: true },
        { name: "tier", type: "text" },
        { name: "created_at", type: "timestamp" },
      ],
    },
    {
      name: "orders",
      indexes: 3,
      columns: [
        { name: "id", type: "uuid" },
        { name: "user_id", type: "uuid" },
        { name: "cart_id", type: "uuid" },
        { name: "total", type: "numeric" },
        { name: "status", type: "text" },
        { name: "created_at", type: "timestamp" },
      ],
    },
    {
      name: "order_items",
      indexes: 2,
      columns: [
        { name: "id", type: "uuid" },
        { name: "order_id", type: "uuid" },
        { name: "product_id", type: "text" },
        { name: "quantity", type: "integer" },
        { name: "price", type: "numeric" },
      ],
    },
    {
      name: "coupons",
      indexes: 2,
      columns: [
        { name: "id", type: "uuid" },
        { name: "code", type: "text" },
        { name: "discount", type: "numeric" },
        { name: "expires_at", type: "timestamp" },
        { name: "usage_limit", type: "integer" },
      ],
    },
    {
      name: "sessions",
      indexes: 2,
      columns: [
        { name: "id", type: "uuid" },
        { name: "user_id", type: "uuid" },
        { name: "token", type: "text" },
        { name: "expires_at", type: "timestamp" },
      ],
    },
  ],
};

export type DbType = "postgres" | "mysql" | "mongodb" | "sqlite" | "unknown";

export function detectDbType(connectionString: string): DbType {
  if (connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://")) {
    return "postgres";
  }
  if (connectionString.startsWith("mysql://")) return "mysql";
  if (connectionString.startsWith("mongodb://") || connectionString.startsWith("mongodb+srv://")) {
    return "mongodb";
  }
  if (connectionString.startsWith("sqlite://") || connectionString.endsWith(".db")) {
    return "sqlite";
  }
  return "unknown";
}

export function generateSchema(_connectionString: string): DbSchema {
  // v0 always returns the fixed schema regardless of the real connection
  // string contents — see docs/02-ARCHITECTURE.md §3 ("forge db link").
  return FIXED_SCHEMA;
}

export function totalIndexes(schema: DbSchema): number {
  return schema.tables.reduce((sum, t) => sum + t.indexes, 0);
}

/**
 * Distributes `totalRows` across tables with a believable, non-uniform
 * weighting (e.g. orders/sessions get more rows than coupons).
 */
export function generateSyntheticRows(schema: DbSchema, totalRows: number): RowCounts {
  const weights: Record<string, number> = {
    users: 0.25,
    orders: 0.35,
    order_items: 0.25,
    coupons: 0.02,
    sessions: 0.13,
  };

  const perTable: Record<string, number> = {};
  let assigned = 0;

  for (const table of schema.tables) {
    const weight = weights[table.name] ?? 1 / schema.tables.length;
    const count = Math.round(totalRows * weight);
    perTable[table.name] = count;
    assigned += count;
  }

  // Correct rounding drift onto the largest table so the total matches exactly.
  const diff = totalRows - assigned;
  if (diff !== 0) {
    const largest = schema.tables.reduce((a, b) =>
      perTable[a.name] >= perTable[b.name] ? a : b
    );
    perTable[largest.name] += diff;
  }

  return { totalRows, perTable };
}

export function getTable(schema: DbSchema, name: string): DbTable | undefined {
  return schema.tables.find((t) => t.name === name);
}
