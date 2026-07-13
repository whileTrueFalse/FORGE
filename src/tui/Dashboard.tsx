// The live run dashboard for `forge tui`. Presentational: receives the
// accumulated run state from App and lays it out as a multi-panel cockpit —
// status strip, connectors/policy, live policy log, metrics, and simulations.

import { Box, Text } from "ink";
import { Panel, StatRow, Bar, Chip, KeyBar, theme } from "./components.js";
import { MARK } from "./brand.js";
import type { ForgeConfig, PolicyStats, SimResult } from "../types.js";
import type { HeaderInfo } from "../core/runEngine.js";

export interface LogLine {
  icon: string;
  color: string;
  text: string;
  subs?: string[];
}

export interface SimState {
  name: string;
  sessions: number;
  count?: number;
  total?: number;
  result?: SimResult;
}

export type RunPhase = "running" | "done";

export interface DashboardProps {
  config: ForgeConfig;
  header: HeaderInfo | null;
  log: LogLine[];
  stats: PolicyStats;
  sims: SimState[];
  passRate: number | null;
  phase: RunPhase;
  elapsedMs: number;
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Dashboard(props: DashboardProps): React.JSX.Element {
  const { config, header, log, stats, sims, passRate, phase, elapsedMs } = props;
  const threshold = config.approve.require_pass_rate;
  const db = config.data.databases[0];
  const mocks = config.data.mocks;
  const visibleLog = log.slice(-16);
  const eligible = passRate !== null && passRate >= threshold;

  return (
    <Box flexDirection="column">
      {/* Status strip */}
      <Box
        borderStyle="single"
        borderColor={theme.accent}
        paddingX={1}
        justifyContent="space-between"
      >
        <Text>
          <Text color={theme.brand} bold>
            {MARK} FORGE
          </Text>
          <Text dimColor>{`  ${header?.runId ?? "run"} · ${header?.project ?? config.project} · `}</Text>
        </Text>
        <Box>
          <Text dimColor>{`${header?.agent ?? "agent"} → ${header?.scope ?? ""}   ⏱ ${fmtElapsed(elapsedMs)}   `}</Text>
          {phase === "running" ? (
            <Chip label="running" color={theme.info} />
          ) : eligible ? (
            <Chip label="eligible" color={theme.pass} />
          ) : (
            <Chip label="attention" color={theme.warn} />
          )}
        </Box>
      </Box>

      {/* Body */}
      <Box flexDirection="row">
        {/* Left column */}
        <Box flexDirection="column" width={30}>
          <Panel title="Connectors">
            {db ? (
              <>
                <StatRow label="sim db" value={db.type} color={theme.pass} />
                <StatRow label="rows" value={db.sim_rows.toLocaleString()} />
              </>
            ) : (
              <Text dimColor>no db linked</Text>
            )}
            <Box marginTop={1}>
              <Text dimColor>mocks</Text>
            </Box>
            {mocks.length === 0 ? (
              <Text dimColor>  none</Text>
            ) : (
              mocks.map((m) => <StatRow key={m.name} label={`  ${m.name}`} value="✓" color={theme.pass} />)
            )}
          </Panel>
          <Panel title="Policy">
            <StatRow label="preset" value={config.policy.preset} color={theme.info} />
            <StatRow label="on_block" value={config.policy.on_block} />
            <StatRow label="on_intercept" value={config.policy.on_intercept} />
          </Panel>
        </Box>

        {/* Center: live policy log */}
        <Box flexGrow={1}>
          <Panel title="Live Policy Log" flexGrow={1} minHeight={22}>
            <Box marginBottom={1}>
              <Text color={theme.pass}>✓ pass</Text>
              <Text dimColor>{"   "}</Text>
              <Text color={theme.warn}>⚠ intercept</Text>
              <Text dimColor>{"   "}</Text>
              <Text color={theme.block}>✗ block</Text>
            </Box>
            {visibleLog.length === 0 ? (
              <Text dimColor>waiting for agent operations…</Text>
            ) : (
              visibleLog.map((line, i) => (
                <Box key={i} flexDirection="column">
                  <Text>
                    <Text color={line.color}>{line.icon} </Text>
                    <Text dimColor={line.color === theme.dim}>{line.text}</Text>
                  </Text>
                  {line.subs?.map((s, j) => (
                    <Text key={j} dimColor>
                      {"   "}
                      {s}
                    </Text>
                  ))}
                </Box>
              ))
            )}
          </Panel>
        </Box>

        {/* Right column */}
        <Box flexDirection="column" width={34}>
          <Panel title="Run Metrics">
            <StatRow label="intercepts" value={String(stats.intercepts)} color={theme.warn} />
            <StatRow label="blocks" value={String(stats.blocks)} color={theme.block} />
            <StatRow label="auto-resolved" value={String(stats.autoResolved)} color={theme.pass} />
            <StatRow
              marginTop={1}
              label="pass rate"
              value={passRate === null ? "…" : `${passRate}%`}
              color={passRate === null ? undefined : eligible ? theme.pass : theme.warn}
            />
            <StatRow label="threshold" value={`${threshold}%`} />
            <Box marginTop={1}>
              <Bar value={passRate ?? 0} width={20} color={passRate === null ? theme.info : eligible ? theme.pass : theme.warn} />
            </Box>
          </Panel>
          <Panel title="Simulations" minHeight={8}>
            {sims.length === 0 ? (
              <Text dimColor>no sims queued</Text>
            ) : (
              sims.map((s) => {
                const r = s.result;
                const rate = r ? (r.passedSessions / r.totalSessions) * 100 : undefined;
                const running = r ? r.totalSessions : s.count ?? 0;
                const total = r ? r.totalSessions : s.total ?? s.sessions;
                const color = rate === undefined ? theme.info : rate >= 95 ? theme.pass : theme.warn;
                const barVal = rate ?? (total ? Math.round((running / total) * 100) : 0);
                return (
                  <Box key={s.name} flexDirection="column" marginBottom={1}>
                    <Text>{s.name}</Text>
                    <Box>
                      <Bar value={barVal} color={color} />
                      <Text> </Text>
                      <Text color={color}>
                        {rate === undefined ? `${running.toLocaleString()}/${total.toLocaleString()}` : `${rate.toFixed(1)}%`}
                      </Text>
                    </Box>
                    {r && rate !== undefined && rate < 95 ? <Text dimColor>↳ {r.failingPersona}</Text> : null}
                  </Box>
                );
              })
            )}
          </Panel>
        </Box>
      </Box>

      {/* Done banner */}
      {phase === "done" ? (
        <Box borderStyle="single" borderColor={eligible ? theme.pass : theme.warn} paddingX={1} flexDirection="column">
          <Text>
            <Text color={eligible ? theme.pass : theme.warn} bold>
              {eligible ? "● RUN COMPLETE — eligible to approve" : "● RUN COMPLETE — requires attention"}
            </Text>
            <Text dimColor>{`   pass rate ${passRate}% vs threshold ${threshold}%`}</Text>
          </Text>
          <Box marginTop={1}>
            <Text dimColor>next: </Text>
            <Text color={theme.key}>forge diff {header?.runId}</Text>
            <Text dimColor>{"   "}</Text>
            <Text color={theme.key}>forge report {header?.runId}</Text>
            <Text dimColor>{"   "}</Text>
            <Text color={theme.key}>forge approve {header?.runId}{eligible ? "" : " --force"}</Text>
          </Box>
        </Box>
      ) : null}

      {/* Footer */}
      <Box paddingX={1}>
        <KeyBar hints={[{ keyLabel: "q", action: "quit" }]} />
      </Box>
    </Box>
  );
}
