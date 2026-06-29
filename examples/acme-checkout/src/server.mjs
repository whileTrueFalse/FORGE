// Sample target app for Forge `--real` runs. A small checkout API that talks to
// Postgres (via `pg`) and Stripe (via https). It is written like a normal
// production service — it does NOT know it is sandboxed. Forge's preload hook
// intercepts its db/http calls, reroutes them to the sandbox, and enforces
// policy. The app reads DATABASE_URL (the orchestrator points this at the
// sandbox container) and calls the real Stripe host (the hook redirects it to
// the local mock).
//
// IMPORTANT: this app ships an intentional bug — it does not handle a declined
// (expired) card when a coupon has been applied — so the `expired_card_with_
// coupon` simulation surfaces a REAL failure, not a seeded number.

import http from "node:http";
import https from "node:https";
import pg from "pg";

const PORT = Number(process.env.PORT || 3000);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Per-connection cart state keyed by a trivial session id (demo only).
const carts = new Map();

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// Charge via Stripe (the hook redirects api.stripe.com → local mock).
function chargeCard(cardStatus) {
  return new Promise((resolve, reject) => {
    const path = cardStatus === "expired" ? "/v1/charges/declined" : "/v1/charges";
    const req = https.request({ host: "api.stripe.com", path, method: "POST" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const sid = req.headers["x-session"] || "anon";
  const body = await readJson(req);

  try {
    if (req.url === "/health") return send(res, 200, { ok: true });

    if (req.url === "/cart") {
      carts.set(sid, { items: body.items ?? 1, coupon: null, card: null });
      return send(res, 200, { cart: carts.get(sid) });
    }

    if (req.url === "/coupon") {
      const cart = carts.get(sid) ?? {};
      // Look up the coupon in the (sandbox) DB.
      await pool.query("SELECT id, discount, expires_at FROM coupons WHERE code = $1", [body.code]);
      cart.coupon = body.code;
      carts.set(sid, cart);
      return send(res, 200, { applied: body.code });
    }

    if (req.url === "/payment") {
      const cart = carts.get(sid) ?? {};
      cart.card = body.card_status ?? "valid";
      carts.set(sid, cart);
      return send(res, 200, { card: cart.card });
    }

    if (req.url === "/checkout") {
      const cart = carts.get(sid) ?? { items: 1, card: "valid", coupon: null };
      await pool.query("SELECT id, total FROM orders WHERE user_id = $1", [sid]);
      await pool.query(
        "INSERT INTO orders (user_id, cart_id, total, status) VALUES ($1, $2, $3, $4)",
        [sid, sid, 100, "pending"]
      );

      const charge = await chargeCard(cart.card);

      // --- THE BUG ---
      // When a coupon was applied we assume the charge always succeeds and skip
      // the decline check, so an expired card + active coupon throws instead of
      // returning a clean error.
      if (cart.coupon) {
        const discounted = applyDiscount(charge.body.amount); // charge.body has no amount on decline → throws
        await pool.query("UPDATE orders SET status = $1 WHERE user_id = $2", ["paid", sid]);
        return send(res, 200, { status: "paid", total: discounted });
      }

      // Non-coupon path handles declines correctly.
      if (charge.status >= 400) return send(res, 402, { error: "CARD_DECLINED" });
      await pool.query("UPDATE orders SET status = $1 WHERE user_id = $2", ["paid", sid]);
      return send(res, 200, { status: "paid" });
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    // Unhandled — this is what the expired-card + coupon path hits.
    return send(res, 500, { error: "expired card + active coupon not handled" });
  }
});

function applyDiscount(amount) {
  // Throws when amount is undefined (decline response has no amount).
  return Math.round(amount * 0.9);
}

server.listen(PORT, () => console.log(`acme-checkout listening on ${PORT}`));
