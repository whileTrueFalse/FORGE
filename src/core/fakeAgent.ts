// Scripted "AI agent" operation generator. See docs/07-FAKE-AGENT-SPEC.md
// for the full specification this implements.
//
// This stands in for a real coding agent attached via (eventually) syscall
// interception. It returns a deterministic, consistent sequence of
// operations that tell the same checkout-flow story used throughout the
// project's docs, regardless of the literal `task` string passed in.

import type { AgentOperation, FileDiff, PolicyVerdict, SimResult, SimulationRef } from "../types.js";

export function generateOperations(_task: string, _scope: string): AgentOperation[] {
  return [
    {
      id: "op1",
      kind: "db_query",
      sql: "SELECT id, total FROM orders WHERE user_id = ?",
      file: "checkout.service.ts",
    },
    {
      id: "op2",
      kind: "db_query",
      sql: "INSERT INTO orders (user_id, cart_id, total, status) VALUES (?, ?, ?, ?)",
      file: "checkout.service.ts",
    },
    {
      id: "op3",
      kind: "db_query",
      sql: "UPDATE orders SET status = ?",
      file: "checkout.service.ts",
    },
    {
      id: "op4",
      kind: "db_query",
      sql: "SELECT * FROM users",
      file: "coupon.validator.ts",
    },
    {
      id: "op5",
      kind: "http_connect",
      host: "api.stripe.com",
      file: "coupon.validator.ts",
    },
  ];
}

/**
 * Given an operation that was blocked (not just rewritten), produce the
 * agent's corrected follow-up operation. Only meaningfully used for op4
 * (wildcard SELECT) in the v0 scripted scenario — see
 * docs/07-FAKE-AGENT-SPEC.md "Self-Correction Behavior".
 */
export function generateCorrection(originalOp: AgentOperation, _verdict: PolicyVerdict): AgentOperation {
  if (originalOp.id === "op4") {
    return {
      id: "op4-corrected",
      kind: "db_query",
      sql: "SELECT id, email_hash, tier FROM users WHERE id = ?",
      file: "coupon.validator.ts",
    };
  }
  // Fallback: return the same operation unchanged (shouldn't normally be hit
  // in v0's fixed scenario for any op other than op4).
  return originalOp;
}

export function generateFileDiff(): FileDiff[] {
  return [
    {
      path: "src/checkout/checkout.service.ts",
      status: "modified",
      hunks: [
        {
          startLine: 41,
          lines: [
            { type: "context", text: "async function processCheckout(userId, cartId, couponCode?) {" },
            { type: "context", text: "  const cart = await db.query(" },
            {
              type: "remove",
              text: "    'SELECT * FROM carts WHERE id = ?', [cartId]",
            },
            {
              type: "add",
              text: "    'SELECT id, items, total, user_id FROM carts WHERE id = ? AND user_id = ?', [cartId, userId]",
            },
            { type: "context", text: "  );" },
            { type: "context", text: "" },
            {
              type: "remove",
              text: "  await db.query('UPDATE orders SET status = ?', [status])",
            },
            {
              type: "add",
              text: "  await db.query('UPDATE orders SET status = ? WHERE id = ? AND user_id = ?', [status, orderId, userId])",
            },
            { type: "context", text: "" },
            { type: "add", text: "  if (couponCode) {" },
            { type: "add", text: "    const coupon = await validateCoupon(couponCode, userId);" },
            {
              type: "add",
              text: "    if (!coupon.valid) throw new CheckoutError('INVALID_COUPON', coupon.reason);",
            },
            { type: "add", text: "    cart.total = applyDiscount(cart.total, coupon.discount);" },
            { type: "add", text: "  }" },
          ],
        },
      ],
    },
    {
      path: "src/checkout/coupon.validator.ts",
      status: "added",
      hunks: [
        {
          startLine: 1,
          lines: [
            { type: "add", text: "import { db } from '../db';" },
            { type: "add", text: "import { CouponError } from '../errors';" },
            { type: "add", text: "" },
            { type: "add", text: "export async function validateCoupon(code: string, userId: string) {" },
            {
              type: "add",
              text: "  const coupon = await db.query(",
            },
            {
              type: "add",
              text: "    'SELECT id, discount, expires_at, usage_limit FROM coupons WHERE code = ?', [code]",
            },
            { type: "add", text: "  );" },
            { type: "add", text: "  if (!coupon) return { valid: false, reason: 'NOT_FOUND' };" },
            {
              type: "add",
              text: "  if (coupon.expires_at < Date.now()) return { valid: false, reason: 'EXPIRED' };",
            },
            { type: "add", text: "  return { valid: true, discount: coupon.discount };" },
            { type: "add", text: "}" },
          ],
        },
      ],
    },
  ];
}

/**
 * Deterministic-but-jittered pass/fail numbers per simulation, following
 * docs/07-FAKE-AGENT-SPEC.md's "Simulation Result Generation" rules:
 *  - large declarative sims resolve to a 97-99% pass rate
 *  - a small edge-case sim always shows a meaningful partial failure
 *    (60-75% pass rate) tied to the expired_card_with_coupon persona
 */
export function generateSimResult(sim: SimulationRef): SimResult {
  const seed = seedFromString(sim.name);
  const isEdgeCaseSim = sim.sessions <= 1000;

  if (isEdgeCaseSim) {
    const passRate = 0.6 + seededFraction(seed) * 0.15; // 60-75%
    const passed = Math.round(sim.sessions * passRate);
    return {
      name: sim.name,
      totalSessions: sim.sessions,
      passedSessions: passed,
      failedSessions: sim.sessions - passed,
      failureReason: "no error handling for expired card + active coupon combination",
      failingPersona: "expired_card_with_coupon",
    };
  }

  const passRate = 0.97 + seededFraction(seed) * 0.02; // 97-99%
  const passed = Math.round(sim.sessions * passRate);
  return {
    name: sim.name,
    totalSessions: sim.sessions,
    passedSessions: passed,
    failedSessions: sim.sessions - passed,
  };
}

function seedFromString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Deterministic pseudo-random fraction in [0, 1) derived from a seed. */
function seededFraction(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
