// `forge mock add` — see docs/05-CLI-UX-SPEC.md.

import * as ui from "../core/ui.js";
import { loadForgeYaml, saveForgeYaml } from "../core/store.js";
import { getPreset, listPresets } from "../core/mockApi.js";
import type { MockConfig } from "../types.js";

interface MockAddOptions {
  preset?: string;
}

export async function mockAdd(service: string, options: MockAddOptions): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  const preset = getPreset(service);
  if (!preset) {
    const available = listPresets().map((p) => p.service).join(", ");
    ui.errorBox(`unknown service "${service}"`, `available services: ${available}`);
    process.exitCode = 1;
    return;
  }

  console.log();
  ui.ok(`${service} mock registered (preset: ${preset.preset})`);
  if (preset.scenarios) {
    ui.dim(`  scenarios: ${preset.scenarios.join(", ")}`);
  }
  if (preset.capture) {
    ui.dim(`  mode: capture (calls logged, never sent)`);
  }

  const mockConfig: MockConfig = {
    name: service,
    preset: preset.preset,
    scenarios: preset.scenarios,
    capture: preset.capture,
    added_at: new Date().toISOString(),
  };

  config.data.mocks = config.data.mocks.filter((m) => m.name !== service);
  config.data.mocks.push(mockConfig);
  saveForgeYaml(config);
}

export async function mockList(): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  console.log();
  if (config.data.mocks.length === 0) {
    ui.dim("  no mocks registered yet — try `forge mock add stripe --preset ecommerce`");
    return;
  }

  for (const mock of config.data.mocks) {
    ui.ok(`${mock.name} (preset: ${mock.preset})`);
  }
}
