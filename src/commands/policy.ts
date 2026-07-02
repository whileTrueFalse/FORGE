// `forge policy show / list / set <preset>` — view or change the policy preset
// of an existing project (no need to re-init). See docs/06-POLICY-ENGINE-SPEC.md.

import * as ui from "../core/ui.js";
import { loadForgeYaml, saveForgeYaml } from "../core/store.js";
import { POLICY_PRESETS, describePreset } from "../core/policyEngine.js";
import type { PolicyPreset } from "../types.js";

const VALID: PolicyPreset[] = ["default", "strict", "soc2", "hipaa", "custom"];

function requireConfig() {
  const c = loadForgeYaml();
  if (!c) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return null;
  }
  return c;
}

export async function policyShow(): Promise<void> {
  const c = requireConfig();
  if (!c) return;
  console.log();
  ui.info(`preset: ${c.policy.preset}`);
  ui.dim(`  ${describePreset(c.policy.preset)}`);
  ui.dim(`  on_intercept: ${c.policy.on_intercept}  ·  on_block: ${c.policy.on_block}`);
}

export async function policyList(): Promise<void> {
  ui.heading("Policy presets");
  for (const p of POLICY_PRESETS) {
    ui.ok(p.name);
    ui.dim(`  ${p.description}`);
  }
}

export async function policySet(preset: string): Promise<void> {
  const c = requireConfig();
  if (!c) return;
  const p = preset.toLowerCase();
  if (!VALID.includes(p as PolicyPreset)) {
    ui.errorBox(`unknown preset: ${preset}`, `valid: ${VALID.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  c.policy.preset = p as PolicyPreset;
  c.policy.on_block = p === "soc2" || p === "hipaa" ? "stop_run" : "notify_agent";
  saveForgeYaml(c);
  console.log();
  ui.ok(`policy → ${p}`);
  ui.dim(`  ${describePreset(p as PolicyPreset)}`);
}
