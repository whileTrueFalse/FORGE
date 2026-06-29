// `forge target set` / `forge target show` — configure the app Forge launches
// and drives for a real (`--real`) run. See docs/09-ENGINE-ARCHITECTURE.md.

import * as ui from "../core/ui.js";
import { loadForgeYaml, saveForgeYaml } from "../core/store.js";

interface TargetSetOptions {
  port?: string;
  cwd?: string;
  ready?: string;
}

export async function targetSet(start: string, options: TargetSetOptions): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }
  config.target = {
    start,
    port: Number(options.port ?? 3000),
    cwd: options.cwd,
    ready: options.ready,
  };
  saveForgeYaml(config);
  console.log();
  ui.ok(`target set · ${start} · port ${config.target.port}`);
  if (config.target.cwd) ui.dim(`  cwd: ${config.target.cwd}`);
  ui.dim("  real run: forge run --real");
}

export async function targetShow(): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }
  console.log();
  if (!config.target) {
    ui.dim('  no target set — forge target set "node src/server.mjs" --port 3000');
    return;
  }
  ui.ok(`start: ${config.target.start}`);
  ui.dim(`  port: ${config.target.port}${config.target.cwd ? `  ·  cwd: ${config.target.cwd}` : ""}`);
}
