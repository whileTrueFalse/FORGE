// Live "getting started" checklist for the shell. Reads project + run state and
// shows lifecycle progress with the next concrete step, so the shell guides the
// user through init → link → mock → sim → attach → run instead of assuming
// they know the flow.

import { Box, Text } from "ink";
import { theme } from "../tui/components.js";
import { loadForgeYaml, loadState, listRuns } from "../core/store.js";

export interface Step {
  label: string;
  done: boolean;
  next: string;
}

export function getSteps(): Step[] {
  const c = loadForgeYaml();
  const state = loadState();
  const runs = listRuns();
  // If a target app is configured, guide the user to the real engine.
  const runCmd = c?.target ? "forge run --real" : "forge run";
  return [
    { label: "project", done: Boolean(c), next: "forge init <name>" },
    { label: "database", done: Boolean(c && c.data.databases.length > 0), next: "forge db link" },
    { label: "mocks", done: Boolean(c && c.data.mocks.length > 0), next: "forge mock add" },
    { label: "simulation", done: Boolean(c && c.simulations.length > 0), next: "forge sim add" },
    { label: "agent", done: Boolean(c && c.agents.length > 0 && state.attachedAgent), next: "forge attach" },
    { label: "run", done: runs.length > 0, next: runCmd },
  ];
}

export function Checklist({ steps }: { steps: Step[] }): React.JSX.Element {
  const next = steps.find((s) => !s.done);
  const runCmd = steps.find((s) => s.label === "run")?.next ?? "forge run";
  return (
    <Box flexDirection="column">
      {steps.map((s) => (
        <Text key={s.label} color={s.done ? theme.pass : theme.dim}>
          {(s.done ? "✓ " : "○ ") + s.label}
        </Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        {next ? (
          <Box flexDirection="column">
            <Text dimColor>next step</Text>
            <Text color={theme.key}>{next.next}</Text>
          </Box>
        ) : (
          <Text color={theme.pass}>✓ ready — {runCmd}</Text>
        )}
      </Box>
    </Box>
  );
}
