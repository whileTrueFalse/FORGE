// Branded welcome / launch screen for `forge tui`. Shows the FORGE wordmark,
// what this session is about to do (loaded connectors, sims, policy, agent),
// the four-stage flow, a color legend, and how to proceed.

import { Box, Text } from "ink";
import { Logo, Panel, StatRow, Chip, KeyBar, theme } from "./components.js";
import { TAGLINE, SUBTAGLINE } from "./brand.js";
import type { ForgeConfig } from "../types.js";

function FlowStage({ n, title, desc }: { n: string; title: string; desc: string }): React.JSX.Element {
  return (
    <Box flexDirection="column" width={20}>
      <Text>
        <Text color={theme.accent} bold>
          {n}
        </Text>
        <Text bold> {title}</Text>
      </Text>
      <Text dimColor>{desc}</Text>
    </Box>
  );
}

function Arrow(): React.JSX.Element {
  return (
    <Box width={3} justifyContent="center">
      <Text color={theme.dim}>→</Text>
    </Box>
  );
}

export function Welcome({ config, task }: { config: ForgeConfig; task: string }): React.JSX.Element {
  const db = config.data.databases[0];
  const mocks = config.data.mocks.map((m) => m.name).join(", ") || "none";
  const agent = config.agents[0];

  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Logo align="center" />
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text color={theme.brand} bold>
          {TAGLINE}
        </Text>
        <Text dimColor>{SUBTAGLINE}</Text>
      </Box>

      {/* Session overview */}
      <Box marginTop={1} width={92}>
        <Panel title="This session" flexGrow={1}>
          <Box>
            <Box flexDirection="column" width={44}>
              <StatRow label="project" value={config.project} color={theme.title} />
              <Box justifyContent="space-between">
                <Text dimColor>mode</Text>
                <Chip label={config.mode} color={theme.info} />
              </Box>
              <StatRow label="agent" value={agent?.name ?? "—"} />
              <StatRow label="scope" value={agent?.scope ?? "—"} />
            </Box>
            <Box flexDirection="column" width={44} marginLeft={2}>
              <StatRow label="sim database" value={db ? `${db.type} · ${db.sim_rows.toLocaleString()} rows` : "none"} color={db ? theme.pass : theme.dim} />
              <StatRow label="mocks" value={mocks} color={theme.pass} />
              <StatRow label="simulations" value={String(config.simulations.length)} />
              <StatRow label="policy" value={`${config.policy.preset} · on_block: ${config.policy.on_block}`} color={theme.info} />
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>task: </Text>
            <Text>{task}</Text>
          </Box>
        </Panel>
      </Box>

      {/* Flow */}
      <Box marginTop={1} width={92}>
        <Panel title="How a run works" flexGrow={1}>
          <Box>
            <FlowStage n="1" title="Intercept" desc="every db / fs / http op the agent attempts" />
            <Arrow />
            <FlowStage n="2" title="Rewrite / Block" desc="unsafe ops fixed or stopped by policy" />
            <Arrow />
            <FlowStage n="3" title="Simulate" desc="run synthetic sessions vs the change" />
            <Arrow />
            <FlowStage n="4" title="Gate" desc="pass-rate threshold gates approval" />
          </Box>
        </Panel>
      </Box>

      {/* Legend + actions */}
      <Box marginTop={1} width={92} justifyContent="space-between">
        <Box>
          <Text color={theme.pass}>✓ pass</Text>
          <Text dimColor>{"   "}</Text>
          <Text color={theme.warn}>⚠ intercept / rewrite</Text>
          <Text dimColor>{"   "}</Text>
          <Text color={theme.block}>✗ block</Text>
        </Box>
        <Text dimColor>nothing here touches a real system</Text>
      </Box>

      <Box marginTop={1}>
        <KeyBar
          hints={[
            { keyLabel: "⏎", action: "start run" },
            { keyLabel: "t", action: "guided tour" },
            { keyLabel: "q", action: "quit" },
          ]}
        />
      </Box>
    </Box>
  );
}
