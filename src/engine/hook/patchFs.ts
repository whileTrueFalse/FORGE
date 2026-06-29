// Monkeypatches fs write operations so the agent can only write within its
// declared scope; out-of-scope writes throw. Decision logic lives in
// intercept.ts; this is the wiring.

import fs from "node:fs";
import { interceptFsWrite, ForgeBlockedError, type InterceptDeps } from "./intercept.js";
import type { AgentOperation } from "../../types.js";

let opCounter = 0;

/** Extract the target path from an fs write call (path is always arg 0). */
export function pathFromWriteArgs(args: unknown[]): string | null {
  const a = args[0];
  if (typeof a === "string") return a;
  if (a instanceof URL) return a.pathname;
  if (Buffer.isBuffer(a)) return a.toString();
  return null;
}

function guard(deps: InterceptDeps, path: string): void {
  const op: AgentOperation = { id: `fs${++opCounter}`, kind: "fs_write", path, file: path };
  const decision = interceptFsWrite(op, deps);
  if (!decision.allowed) throw new ForgeBlockedError(decision.reason ?? `write outside scope: ${path}`);
}

type AnyFn = (...args: unknown[]) => unknown;

/** Install fs write-scope guards on writeFile / appendFile (sync + async). */
export function installFsPatch(deps: InterceptDeps): void {
  const wrap = (orig: AnyFn): AnyFn =>
    function patched(this: unknown, ...args: unknown[]) {
      const path = pathFromWriteArgs(args);
      if (path) guard(deps, path);
      return orig.apply(this, args);
    };

  for (const name of ["writeFile", "writeFileSync", "appendFile", "appendFileSync"] as const) {
    const orig = fs[name] as unknown as AnyFn;
    (fs as unknown as Record<string, AnyFn>)[name] = wrap(orig);
  }
  fs.promises.writeFile = wrap(fs.promises.writeFile as unknown as AnyFn) as typeof fs.promises.writeFile;
  fs.promises.appendFile = wrap(fs.promises.appendFile as unknown as AnyFn) as typeof fs.promises.appendFile;
}
