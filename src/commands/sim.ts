// `forge sim add` — see docs/05-CLI-UX-SPEC.md and docs/04-SIM-YAML-SPEC.md.

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import * as ui from "../core/ui.js";
import { loadForgeYaml, saveForgeYaml, saveSimFile } from "../core/store.js";
import type { SimFile, SimulationRef } from "../types.js";

interface SimAddOptions {
  file?: string;
  userType?: string;
  count?: string;
}

function validateSimFile(sim: SimFile): string[] {
  const errors: string[] = [];
  if (!sim.name) errors.push("missing required field: name");
  if (!sim.mode) errors.push("missing required field: mode");

  if (sim.mode === "declarative" || sim.mode === "combined") {
    if (!sim.personas || sim.personas.length === 0) {
      errors.push("declarative/combined mode requires at least one persona");
    }
    if (sim.sessions === undefined) {
      errors.push("declarative/combined mode requires 'sessions'");
    }
  }
  if (sim.mode === "scripted") {
    if (!sim.steps || sim.steps.length === 0) {
      errors.push("scripted mode requires at least one step");
    }
    if (sim.repeat === undefined) {
      errors.push("scripted mode requires 'repeat'");
    }
  }
  if (sim.mode === "combined") {
    if (!sim.scripted || sim.scripted.length === 0) {
      errors.push("combined mode requires at least one 'scripted' block");
    }
  }
  return errors;
}

export async function simAdd(options: SimAddOptions): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  console.log();

  if (options.file) {
    const fullPath = path.resolve(process.cwd(), options.file);
    if (!fs.existsSync(fullPath)) {
      ui.errorBox(`file not found: ${options.file}`);
      process.exitCode = 1;
      return;
    }

    const raw = fs.readFileSync(fullPath, "utf-8");
    let sim: SimFile;
    try {
      sim = yaml.load(raw) as SimFile;
    } catch (err) {
      ui.errorBox("failed to parse sim YAML", String(err));
      process.exitCode = 1;
      return;
    }

    const errors = validateSimFile(sim);
    if (errors.length > 0) {
      ui.errorBox("invalid sim file", errors.join("; "));
      process.exitCode = 1;
      return;
    }

    const savedPath = saveSimFile(sim.name, raw);
    const ref: SimulationRef = {
      name: sim.name,
      file: savedPath,
      sessions: sim.sessions ?? sim.repeat ?? 0,
      concurrency: sim.concurrency,
    };

    config.simulations = config.simulations.filter((s) => s.name !== sim.name);
    config.simulations.push(ref);
    saveForgeYaml(config);

    ui.ok(`simulation loaded: "${sim.name}" (${sim.mode})`);
    if (sim.personas) {
      ui.dim(`  ${sim.personas.length} personas · ${sim.sessions?.toLocaleString()} sessions`);
    } else if (sim.steps) {
      ui.dim(`  ${sim.steps.length} steps · ${sim.repeat?.toLocaleString()} sessions`);
    }
    return;
  }

  if (options.userType) {
    const count = Number(options.count ?? "500");
    const simName = "edge-cases";

    const simFile: SimFile = {
      name: simName,
      mode: "declarative",
      personas: [{ type: options.userType, weight: 1.0 }],
      sessions: count,
    };

    const yamlText = yaml.dump(simFile, { lineWidth: 100 });
    const savedPath = saveSimFile(simName, yamlText);

    const ref: SimulationRef = {
      name: simName,
      file: savedPath,
      sessions: count,
    };

    config.simulations = config.simulations.filter((s) => s.name !== simName);
    config.simulations.push(ref);
    saveForgeYaml(config);

    ui.ok(`simulation created: "${simName}"`);
    ui.dim(`  persona: ${options.userType} · ${count.toLocaleString()} sessions`);
    ui.dim(`  saved → ${savedPath}`);
    return;
  }

  ui.errorBox(
    "no input provided",
    "use --file <path> or --user-type <type> --count <n>"
  );
  process.exitCode = 1;
}

export async function simList(): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  console.log();
  if (config.simulations.length === 0) {
    ui.dim("  no simulations registered yet — try `forge sim add --file <path>`");
    return;
  }

  for (const sim of config.simulations) {
    ui.ok(`${sim.name} — ${sim.sessions.toLocaleString()} sessions (${sim.file})`);
  }
}
