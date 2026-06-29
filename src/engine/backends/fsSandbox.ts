// Scoped filesystem sandbox. Writes the agent makes are confined to the agent's
// declared scope; out-of-scope (or read-only) paths are denied by the same
// policy rule the engine uses everywhere else (rule 5). Permitted writes are
// redirected under a temp root so they're isolated and diffable.
// See docs/09-ENGINE-ARCHITECTURE.md §7.3.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateOperation } from "../../core/policyEngine.js";
import type { FsSandbox } from "../types.js";
import type { ResolvedPolicy } from "../../types.js";

// Minimal resolved policy that activates only the fs-scope rule.
const FS_POLICY: ResolvedPolicy = {
  preset: "default",
  activeRules: ["fs_scope"],
  piiFields: [],
  onIntercept: "rewrite",
  onBlock: "notify_agent",
};

export function createFsSandbox(scope: string, readOnly: string[] = []): FsSandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-fs-"));
  const ctx = { scope, readOnly, knownMocks: {} };

  return {
    root,
    allows(p: string): boolean {
      const verdict = evaluateOperation({ id: "fs", kind: "fs_write", path: p, file: p }, FS_POLICY, ctx);
      return verdict.verdict === "pass";
    },
    async teardown(): Promise<void> {
      await fs.promises.rm(root, { recursive: true, force: true });
    },
  };
}
