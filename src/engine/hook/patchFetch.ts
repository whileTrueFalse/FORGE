// Monkeypatches the global `fetch` (undici) so outbound calls are intercepted
// the same way http(s).request is — redirected to the local mock server, or
// blocked if unmocked. Node's global fetch is undici and does NOT go through
// http.request, so patchHttp.ts alone leaves every fetch() call uncovered.
// Decision logic lives in intercept.ts; this is the wiring.

import { interceptHttpConnect, ForgeBlockedError, type InterceptDeps } from "./intercept.js";
import type { AgentOperation } from "../../types.js";

let opCounter = 0;

/** Extract the destination hostname from fetch(input) where input is
 *  string | URL | Request. Returns null for relative URLs / unparseable input
 *  (those pass through untouched). */
export function hostFromFetchInput(input: unknown): string | null {
  try {
    if (typeof input === "string") return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === "object" && typeof (input as { url?: unknown }).url === "string") {
      return new URL((input as { url: string }).url).hostname; // Request object
    }
  } catch {
    return null;
  }
  return null;
}

/** Rewrite the fetch input's host/protocol/port to the mock URL, preserving the
 *  path + query. Returns a value shaped like the original input (string, URL, or
 *  Request) so headers/method/body survive on Request inputs. */
export function redirectFetchInput(input: unknown, mockUrl: string): unknown {
  const mock = new URL(mockUrl);
  const rewrite = (u: URL): URL => {
    u.protocol = mock.protocol;
    u.host = mock.host;
    u.hostname = mock.hostname;
    u.port = mock.port;
    return u;
  };
  if (typeof input === "string") return rewrite(new URL(input)).toString();
  if (input instanceof URL) return rewrite(new URL(input.toString()));
  if (input && typeof input === "object" && typeof (input as { url?: unknown }).url === "string") {
    const newUrl = rewrite(new URL((input as { url: string }).url)).toString();
    try {
      // Copy method/headers/body/etc. from the original Request onto the new URL.
      return new Request(newUrl, input as RequestInit);
    } catch {
      return newUrl;
    }
  }
  return input;
}

type FetchFn = (input: unknown, init?: unknown) => Promise<unknown>;

export function wrapFetch(original: FetchFn, deps: InterceptDeps, hostRedirects: Record<string, string>): FetchFn {
  return function patchedFetch(this: unknown, input: unknown, init?: unknown): Promise<unknown> {
    const host = hostFromFetchInput(input);
    if (!host) return original.call(this, input, init);
    const op: AgentOperation = { id: `fetch${++opCounter}`, kind: "http_connect", host, file: "app" };
    const decision = interceptHttpConnect(op, deps);
    if (decision.action === "block") {
      return Promise.reject(new ForgeBlockedError(decision.reason ?? `no mock for ${host}`));
    }
    if (decision.action === "rewrite") {
      const target = hostRedirects[host];
      if (target) return original.call(this, redirectFetchInput(input, target), init);
    }
    return original.call(this, input, init);
  };
}

/** Install the global fetch patch. `hostRedirects` maps real host → mock URL.
 *  Returns false if the runtime has no global fetch (very old Node). */
export function installFetchPatch(deps: InterceptDeps, hostRedirects: Record<string, string>): boolean {
  if (typeof globalThis.fetch !== "function") return false;
  globalThis.fetch = wrapFetch(globalThis.fetch as FetchFn, deps, hostRedirects) as typeof fetch;
  return true;
}
