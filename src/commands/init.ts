// `forge init` — see docs/05-CLI-UX-SPEC.md.

import readline from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import * as ui from "../core/ui.js";
import { forgeYamlExists, saveForgeYaml, ensureForgeDirs, getProjectRoot, setProjectRoot } from "../core/store.js";
import { detectProject } from "../core/detect.js";
import type { ForgeConfig, PolicyPreset } from "../types.js";

interface InitOptions {
  name?: string;
  stack?: string;
  policy?: string;
  force?: boolean;
}

const VALID_PRESETS: PolicyPreset[] = ["default", "strict", "soc2", "hipaa", "custom"];

function normalizePreset(value: string): PolicyPreset {
  const v = value.trim().toLowerCase();
  return (VALID_PRESETS as string[]).includes(v) ? (v as PolicyPreset) : "default";
}

async function prompt(question: string, defaultValue: string): Promise<string> {
  if (!process.stdin.isTTY) return defaultValue;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`? ${question} `);
  rl.close();
  return answer.trim() || defaultValue;
}

export async function init(options: InitOptions): Promise<void> {
  console.log();
  const projectName = options.name ?? (await prompt("project name:", "my-project"));
  const stack = options.stack ?? (await prompt("stack (free text, just a label):", "Node.js"));
  const policyPreset = normalizePreset(
    options.policy ?? (await prompt("policy preset: (default/strict/soc2/hipaa)", "default"))
  );

  // If a project already exists here, scaffold the new one in ./<name>/ instead
  // of erroring — so `forge init <name>` from within a project makes a fresh one.
  let inSubdir = false;
  if (forgeYamlExists() && !options.force) {
    const sub = path.join(getProjectRoot(), projectName);
    if (fs.existsSync(path.join(sub, "forge.yaml"))) {
      ui.errorBox(`project "${projectName}" already exists`, "pick another name, or pass --force");
      process.exitCode = 1;
      return;
    }
    fs.mkdirSync(sub, { recursive: true });
    setProjectRoot(sub);
    inSubdir = true;
  }

  // soc2/hipaa never auto-continue past a hard block (see policy spec §preset map).
  const onBlock = policyPreset === "soc2" || policyPreset === "hipaa" ? "stop_run" : "notify_agent";

  const config: ForgeConfig = {
    project: projectName,
    version: 1,
    mode: "sandbox",
    data: { databases: [], mocks: [] },
    simulations: [],
    policy: {
      preset: policyPreset,
      rules: [
        { block: "SELECT *" },
        { block: "DROP TABLE" },
        { block: "TRUNCATE" },
        { require: "WHERE on UPDATE/DELETE" },
        { pii_fields: ["email", "phone", "address", "ssn"] },
        { require: "auth on /api/**" },
      ],
      on_intercept: "rewrite",
      on_block: onBlock,
    },
    agents: [],
    approve: {
      require_pass_rate: 95,
      require_zero_blocks: false,
      human_approval: true,
    },
    integrations: {},
    sessions: {
      mode: "isolated",
      conflict_detection: true,
      merge_on_approve: true,
    },
  };

  // Auto-configure a real-run target from the project we're initialized in.
  const detected = detectProject(getProjectRoot());
  if (detected.target) config.target = detected.target;

  ensureForgeDirs();
  saveForgeYaml(config);

  console.log();
  ui.ok(`forge.yaml created${inSubdir ? ` in ./${projectName}/` : ""}`);
  ui.ok(".forge/ directory scaffolded");
  if (detected.target) ui.ok(detected.note);
  else ui.dim(`  ${detected.note}`);
  console.log();
  ui.dim(`  (stack noted: ${stack})`);
  console.log();
  console.log("next: connect your data sources with `forge db link`");
}
