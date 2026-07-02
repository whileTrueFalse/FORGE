// Lightweight project detection so `forge init` can auto-configure a real-run
// target from the project it's initialized in — turning "after init there's
// nothing to do" into "after init, `forge run --real` is one step away".

import fs from "node:fs";
import path from "node:path";
import type { TargetConfig } from "../types.js";

export interface DetectedProject {
  kind: "node" | "unknown";
  target: TargetConfig | null;
  note: string;
}

/**
 * Inspect a directory's package.json and, when it looks like a runnable Node
 * service, propose a `target`. Prefers a *direct* `node …` command (npm-wrapped
 * starts don't receive the hook's IPC channel), falling back to `main`.
 */
export function detectProject(cwd: string): DetectedProject {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { kind: "unknown", target: null, note: "no package.json — set a target with `forge target set`" };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
      main?: string;
    };
    const start = typeof pkg.scripts?.start === "string" ? pkg.scripts.start : null;

    let cmd: string | null = null;
    if (start && /^node\s+\S/.test(start.trim())) cmd = start.trim(); // direct `node …`
    else if (typeof pkg.main === "string" && pkg.main) cmd = `node ${pkg.main}`;

    if (!cmd) {
      const hint = start
        ? `start script isn't a direct \`node …\` command — set one with \`forge target set\``
        : "no start script or main — set a target with `forge target set`";
      return { kind: "node", target: null, note: hint };
    }

    return {
      kind: "node",
      target: { start: cmd, port: 3000, cwd: "." },
      note: `detected Node project → target: ${cmd} (port 3000)`,
    };
  } catch {
    return { kind: "unknown", target: null, note: "couldn't read package.json" };
  }
}
