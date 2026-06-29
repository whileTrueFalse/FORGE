// Local mock HTTP server standing in for third-party APIs. The hook redirects
// the app's outbound calls here, so no real charges/emails/SMS ever happen.
// Real `http.createServer` (no Docker), preset-shaped responses, every call
// recorded for the run report. See docs/09-ENGINE-ARCHITECTURE.md §7.2.

import http from "node:http";
import { KNOWN_THIRD_PARTY_HOSTS } from "../../core/policyEngine.js";
import type { MockCall, MockServerHandle } from "../types.js";

interface MockResponse {
  status: number;
  json: unknown;
}

/** Canned, believable responses per service. A `?scenario=declined` query (or a
 *  `/declined` path) flips Stripe to a card-failure response, so the sim driver
 *  can exercise the declined/expired paths for real. */
function respondFor(service: string, path: string, method: string): MockResponse {
  const declined = /declin|expired|fail/i.test(path);
  switch (service) {
    case "stripe":
      if (declined) {
        return { status: 402, json: { error: { type: "card_error", code: "card_declined", message: "Your card was declined." } } };
      }
      return { status: 200, json: { id: "ch_mock_" + Date.now(), object: "charge", status: "succeeded", paid: true } };
    case "sendgrid":
      // capture-only: accept and log, never send.
      return { status: 202, json: {} };
    case "twilio":
      return { status: 201, json: { sid: "SM_mock", status: "queued" } };
    default:
      return { status: method === "POST" ? 201 : 200, json: { ok: true } };
  }
}

/** real third-party host → registered service, limited to services in use. */
function buildHostMap(services: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [host, service] of Object.entries(KNOWN_THIRD_PARTY_HOSTS)) {
    if (services.includes(service)) map[host] = service;
  }
  return map;
}

export async function startMockServer(services: string[]): Promise<MockServerHandle> {
  const calls: MockCall[] = [];

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const parts = url.replace(/^\/+/, "").split("/");
    const service = parts[0] || "unknown";
    const rest = parts.slice(1).join("/");
    calls.push({ service, method: req.method ?? "GET", path: url, at: new Date().toISOString() });

    const { status, json } = respondFor(service, rest, req.method ?? "GET");
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(json));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    serviceForHost: buildHostMap(services),
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
