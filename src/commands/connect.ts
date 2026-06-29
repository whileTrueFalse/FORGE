// `forge connect` / `forge disconnect` — see docs/05-CLI-UX-SPEC.md.
// All integrations are fully stubbed/simulated in v0 — see
// docs/08-ROADMAP.md "Phase 6: Real CI/CD integration".

import * as ui from "../core/ui.js";
import { loadForgeYaml, saveForgeYaml } from "../core/store.js";

export async function connect(provider: string): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  console.log();

  if (provider === "github") {
    ui.ok("(simulated) github app would be installed on this repo");
    config.mode = "ci";
    config.integrations.github = {
      repo: `${config.project}-org/${config.project}`,
      on: "pr_open",
      post_check: true,
      connected_at: new Date().toISOString(),
    };
    saveForgeYaml(config);
    ui.ok("forge.yaml updated: mode → ci");
    ui.dim("  integrations.github added");
    console.log();
    console.log("  forge will now (in a real deployment) post run reports as PR checks");
    return;
  }

  ui.errorBox(`unknown provider: ${provider}`, "supported in v0: github");
  process.exitCode = 1;
}

export async function disconnect(provider: string): Promise<void> {
  const config = loadForgeYaml();
  if (!config) {
    ui.errorBox("no forge.yaml found", "run `forge init` first");
    process.exitCode = 1;
    return;
  }

  console.log();

  if (provider === "github") {
    delete config.integrations.github;
    if (Object.keys(config.integrations).length === 0) {
      config.mode = "sandbox";
    }
    saveForgeYaml(config);
    ui.ok("github integration removed");
    ui.ok(`forge.yaml updated: mode → ${config.mode}`);
    return;
  }

  ui.errorBox(`unknown provider: ${provider}`, "supported in v0: github");
  process.exitCode = 1;
}
