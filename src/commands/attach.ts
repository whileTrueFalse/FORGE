// `forge attach <agent>` — see docs/05-CLI-UX-SPEC.md.

import { v4 as uuidv4 } from "uuid";
import * as ui from "../core/ui.js";
import { loadForgeYaml, saveForgeYaml, loadState, saveState } from "../core/store.js";
import type { AgentConfig } from "../types.js";

interface AttachOptions {
  scope?: string;
  readOnly?: string[];
}

export async function attach(agentName: string, options: AttachOptions): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  if (!options.scope) {
    ui.errorBox("--scope is required", 'example: forge attach cursor --scope "./src/checkout/**"');
    process.exitCode = 1;
    return;
  }

  const agentConfig: AgentConfig = {
    name: agentName,
    scope: options.scope,
    read_only: options.readOnly ?? [],
    env: "sandbox",
    attached_at: new Date().toISOString(),
  };

  // v0: only one attached agent at a time — overwrite rather than append.
  config.agents = [agentConfig];
  saveForgeYaml(config);

  const state = loadState();
  state.attachedAgent = {
    sessionId: uuidv4().slice(0, 8),
    name: agentConfig.name,
    scope: agentConfig.scope,
    readOnly: agentConfig.read_only,
    attachedAt: agentConfig.attached_at,
  };
  saveState(state);

  console.log();
  ui.ok(`${agentName} attached`);
  ui.dim(`  scope: ${options.scope}`);
  ui.dim(`  env: sandbox (sim db + mocks injected automatically)`);
  console.log();
  console.log("watch live:  forge log --follow");
  console.log("run now:     forge run");
}
