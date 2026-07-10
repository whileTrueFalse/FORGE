// Free-flow defaults. Forge doesn't force a setup path: you can run the sandbox
// without attaching an agent first. When none is attached, we synthesize one
// with full write scope so nothing blocks a run. The only guardrails that stay
// are the inherent ones (e.g. `--real` needs a target app to drive).

import type { AgentConfig } from "../types.js";

/** A stand-in agent used when the user hasn't attached one — full `**` scope. */
export function freeFlowAgent(): AgentConfig {
  return {
    name: "agent",
    scope: "**",
    read_only: [],
    env: "sandbox",
    attached_at: new Date().toISOString(),
  };
}
