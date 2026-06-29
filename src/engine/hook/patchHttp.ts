// Monkeypatches http(s).request so outbound calls to third-party hosts are
// redirected to the local mock server (or blocked if unmocked). Because we
// intercept at the library boundary, there is no TLS MITM and no CA to trust.
// Decision logic lives in intercept.ts; this is the wiring.

import http from "node:http";
import https from "node:https";
import { interceptHttpConnect, ForgeBlockedError, type InterceptDeps } from "./intercept.js";
import type { AgentOperation } from "../../types.js";

let opCounter = 0;

/** Extract the destination hostname from http.request(url | options | url,options). */
export function hostFromRequestArgs(args: unknown[]): string | null {
  const a = args[0];
  if (typeof a === "string") {
    try {
      return new URL(a).hostname;
    } catch {
      return null;
    }
  }
  if (a instanceof URL) return a.hostname;
  if (a && typeof a === "object") {
    const o = a as { hostname?: string; host?: string };
    return o.hostname ?? o.host ?? null;
  }
  return null;
}

type RequestFn = (...args: unknown[]) => http.ClientRequest;

function wrapRequest(original: RequestFn, deps: InterceptDeps, hostRedirects: Record<string, string>): RequestFn {
  return function patchedRequest(this: unknown, ...args: unknown[]): http.ClientRequest {
    const host = hostFromRequestArgs(args);
    if (!host) return original.apply(this, args);
    const op: AgentOperation = { id: `http${++opCounter}`, kind: "http_connect", host, file: "app" };
    const decision = interceptHttpConnect(op, deps);
    if (decision.action === "block") throw new ForgeBlockedError(decision.reason ?? `no mock for ${host}`);
    if (decision.action === "rewrite") {
      const target = hostRedirects[host];
      if (target) {
        // Point the request at the local mock instead of the real host.
        const url = new URL(target);
        const newArgs = [...args];
        if (typeof newArgs[0] === "object" && newArgs[0] && !(newArgs[0] instanceof URL)) {
          newArgs[0] = { ...(newArgs[0] as object), host: url.host, hostname: url.hostname, port: url.port, protocol: url.protocol };
        }
        return original.apply(this, newArgs);
      }
    }
    return original.apply(this, args);
  };
}

/** Install http/https request patches. `hostRedirects` maps real host → mock URL. */
export function installHttpPatch(deps: InterceptDeps, hostRedirects: Record<string, string>): void {
  http.request = wrapRequest(http.request as RequestFn, deps, hostRedirects) as typeof http.request;
  https.request = wrapRequest(https.request as RequestFn, deps, hostRedirects) as typeof https.request;
}
