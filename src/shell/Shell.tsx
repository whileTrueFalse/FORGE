// The interactive Forge shell — a full-screen, framed terminal app. A header
// bar, a left sidebar (setup checklist + workspace summary), a main activity
// panel (scrolling transcript), and a bottom command bar with live `forge`
// suggestions and a persistent keybar (including how to exit). `forge run`
// swaps in the live dashboard; `forge guide` opens the walkthrough; commands
// that need input open guided forms.

import { Box, Text, useApp, useInput } from "ink";
import { useMemo, useRef, useState } from "react";
import { StatRow, theme } from "../tui/components.js";
import { TAGLINE, MARK } from "../tui/brand.js";
import { RunView } from "./RunView.js";
import { GuideView } from "./GuideView.js";
import { FormView } from "./FormView.js";
import { Checklist, getSteps } from "./Checklist.js";
import { useTerminalSize } from "./useTerminalSize.js";
import {
  findCommand,
  argvFromForm,
  type Command,
  type FormField,
  type Handler,
  type OutLine,
  type Tone,
} from "./registry.js";
import { computeSuggestions, applyCompletion } from "./suggest.js";
import { loadForgeYaml, loadState, listRuns, nextRunId, saveRun, saveDiffPatch } from "../core/store.js";
import { buildPatchText } from "../core/diffFormat.js";
import { RunEngine, type RunSource } from "../core/runEngine.js";
import { RealRunEngine } from "../engine/realRun.js";
import type { ForgeConfig, RunRecord } from "../types.js";

type NewEntry =
  | { type: "banner" }
  | { type: "result"; command: string; lines: OutLine[]; ok: boolean };
type Entry = NewEntry & { id: number };

type Mode = "shell" | "run" | "guide" | "form";

interface PendingForm {
  prefix: string;
  fields: FormField[];
  run: Handler;
}

const toneColor: Record<Tone, string | undefined> = {
  ok: theme.pass,
  warn: theme.warn,
  err: theme.block,
  info: theme.info,
  dim: theme.dim,
  plain: theme.text,
  head: theme.accent,
};

function isExecutable(line: string): boolean {
  const t = line.trim().split(/\s+/);
  if (t[0]?.toLowerCase() !== "forge") return false;
  const cmd = findCommand(t[1] ?? "");
  if (!cmd) return false;
  if (cmd.special) return true;
  if (cmd.subcommands?.length) return Boolean(t[2] && cmd.subcommands.some((s) => s.name === t[2]));
  return true;
}

interface Workspace {
  project: string;
  mode: string;
  policy: string;
  db: string;
  mocks: string;
  sims: number;
  agent: string;
  runs: number;
}
function readWorkspace(): Workspace | null {
  const c = loadForgeYaml();
  if (!c) return null;
  return {
    project: c.project,
    mode: c.mode,
    policy: c.policy.preset,
    db: c.data.databases[0]?.type ?? "none",
    mocks: c.data.mocks.map((m) => m.name).join(", ") || "none",
    sims: c.simulations.length,
    agent: c.agents[0]?.name ?? "none",
    runs: listRuns().length,
  };
}

/** Flatten the transcript to individual line nodes so it can be clipped to fit
 *  the activity panel at line granularity (a long output can't overflow). */
function flattenTranscript(entries: Entry[]): React.JSX.Element[] {
  const out: React.JSX.Element[] = [];
  for (const e of entries) {
    if (e.type === "banner") {
      // Compact wordmark (Ember) — stacked like the mockup.
      out.push(
        <Text key={`bm${e.id}`} color={theme.brand} bold>
          {MARK} FORGE
        </Text>
      );
      out.push(
        <Text key={`bt${e.id}`} color={theme.muted}>
          {TAGLINE}
        </Text>
      );
      out.push(
        <Text key={`bh${e.id}`} color={theme.dim}>
          New here? Type <Text color={theme.accent}>forge guide</Text>  ·  Type <Text color={theme.accent}>forge</Text> to see commands.
        </Text>
      );
      out.push(<Text key={`bg${e.id}`}> </Text>);
    } else {
      out.push(
        <Text key={`c${e.id}`}>
          <Text color={theme.dim}>› </Text>
          <Text color={theme.accent}>{e.command}</Text>
        </Text>
      );
      e.lines.forEach((l, i) =>
        out.push(
          <Text key={`l${e.id}-${i}`} color={l.tone === "dim" ? theme.dim : toneColor[l.tone ?? "plain"]} bold={l.tone === "head"}>
            {l.text}
          </Text>
        )
      );
      out.push(<Text key={`s${e.id}`}> </Text>);
    }
  }
  return out;
}

export function Shell(): React.JSX.Element {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, type: "banner" }]);
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [sel, setSel] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [mode, setMode] = useState<Mode>("shell");
  const [form, setForm] = useState<PendingForm | null>(null);
  const idRef = useRef(1);
  const runRef = useRef<{ engine: RunSource; config: ForgeConfig; outcome?: RunRecord } | null>(null);

  const sug = useMemo(() => computeSuggestions(input), [input]);
  const selClamped = Math.min(sel, Math.max(0, sug.items.length - 1));
  const steps = useMemo(() => getSteps(), [entries.length, mode]);
  const ws = useMemo(() => readWorkspace(), [entries.length, mode]);

  const append = (entry: NewEntry) => setEntries((prev) => [...prev, { ...entry, id: idRef.current++ } as Entry]);
  const pushResult = (command: string, lines: OutLine[], ok: boolean) => append({ type: "result", command, lines, ok });

  const setLine = (value: string, cur?: number) => {
    setInput(value);
    setCursor(cur ?? value.length);
  };

  const launchRun = (task: string) => {
    const config = loadForgeYaml();
    if (!config) return pushResult("forge run", [{ text: "✗ no project — run forge init first", tone: "err" }], false);
    const state = loadState();
    if (!state.attachedAgent || config.agents.length === 0) {
      return pushResult("forge run", [{ text: "✗ no agent attached — forge attach <agent> --scope <glob>", tone: "err" }], false);
    }
    const runId = nextRunId();
    const engine = new RunEngine({ runId, task, agent: config.agents[0], config, exitOnBlock: false });
    engine.once("done", (outcome) => {
      const o = outcome as { record: RunRecord };
      saveRun(o.record);
      saveDiffPatch(runId, buildPatchText(o.record.diffs));
      if (runRef.current) runRef.current.outcome = o.record;
    });
    runRef.current = { engine, config };
    setMode("run");
  };

  const launchRealRun = async (task: string) => {
    const config = loadForgeYaml();
    if (!config) return pushResult("forge run --real", [{ text: "✗ no project — run forge init first", tone: "err" }], false);
    if (!config.target) {
      return pushResult("forge run --real", [
        { text: "✗ no target app set — run `forge target set` first", tone: "err" },
        { text: "  (the app Forge launches under the hook and drives for real)", tone: "dim" },
      ], false);
    }
    if (config.agents.length === 0) {
      return pushResult("forge run --real", [{ text: "✗ no agent attached — forge attach <agent> --scope <glob>", tone: "err" }], false);
    }
    const runId = nextRunId();
    // Default to the in-process pglite backend — no Docker required.
    const engine = new RealRunEngine({ runId, task, config, dbBackend: "pglite", sampleCap: 50 });
    engine.once("done", (outcome: unknown) => {
      const o = outcome as { record: RunRecord };
      saveRun(o.record);
      saveDiffPatch(runId, buildPatchText(o.record.diffs));
      if (runRef.current) runRef.current.outcome = o.record;
    });
    runRef.current = { engine, config };
    setMode("run");
  };

  const launchBox = (command: string) => {
    const config = loadForgeYaml();
    if (!config) return pushResult("forge box", [{ text: "✗ no project — run forge init first", tone: "err" }], false);
    const runId = nextRunId();
    const engine = new RealRunEngine({ runId, task: command, config, dbBackend: "pglite", exec: command });
    engine.once("done", (outcome: unknown) => {
      const o = outcome as { record: RunRecord };
      saveRun(o.record);
      saveDiffPatch(runId, buildPatchText(o.record.diffs));
      if (runRef.current) runRef.current.outcome = o.record;
    });
    runRef.current = { engine, config };
    setMode("run");
  };

  const exitRun = () => {
    const r = runRef.current;
    setMode("shell");
    if (r?.outcome) {
      const rep = r.outcome.report;
      const eligible = rep.passRate >= r.config.approve.require_pass_rate;
      pushResult(`forge run --task "${rep.task}"`, [
        { text: `✓ ${rep.runId} complete · pass ${rep.passRate}% · intercepts ${rep.policyStats.intercepts} · blocks ${rep.policyStats.blocks}`, tone: "ok" },
        { text: eligible ? `  eligible — forge approve ${rep.runId}` : `  requires attention — forge diff/report ${rep.runId}`, tone: eligible ? "dim" : "warn" },
      ], true);
    } else {
      pushResult("forge run", [{ text: "⚠ run aborted", tone: "warn" }], false);
    }
    runRef.current = null;
  };

  const enterForm = (prefix: string, fields: FormField[], run: Handler) => {
    setForm({ prefix, fields, run });
    setMode("form");
  };

  const completeForm = async (values: string[]) => {
    const f = form;
    setForm(null);
    setMode("shell");
    if (!f) return;
    const argv = argvFromForm(f.fields, values);
    try {
      const result = await f.run(argv);
      pushResult(`${f.prefix} ${argv.join(" ")}`.trim(), result.lines, result.ok);
    } catch (e) {
      pushResult(f.prefix, [{ text: `✗ error: ${String(e)}`, tone: "err" }], false);
    }
  };

  const cancelForm = () => {
    const f = form;
    setForm(null);
    setMode("shell");
    pushResult(f?.prefix ?? "form", [{ text: "⚠ cancelled", tone: "warn" }], false);
  };

  async function execute(raw: string): Promise<void> {
    const line = raw.trim();
    setLine("");
    if (!line) return;
    setHistory((h) => (h[h.length - 1] === line ? h : [...h, line]));
    setHistIdx(-1);

    const tokens = line.split(/\s+/);
    if (tokens[0].toLowerCase() !== "forge") {
      return pushResult(line, [{ text: "✗ commands start with `forge` — try: forge help", tone: "err" }], false);
    }
    const cmd: Command | undefined = findCommand(tokens[1] ?? "");
    if (!cmd) return pushResult(line, [{ text: `✗ unknown command: ${tokens[1] ?? "(none)"} — forge help`, tone: "err" }], false);

    if (cmd.special === "quit") return exit();
    if (cmd.special === "guide") return setMode("guide");
    if (cmd.special === "clear") return setEntries([{ id: idRef.current++, type: "banner" }]);
    if (cmd.special === "run") {
      const real = tokens.includes("--real");
      const clean = tokens.filter((t) => t !== "--real");
      const tIdx = clean.indexOf("--task");
      const task = (tIdx >= 0 ? clean.slice(tIdx + 1).join(" ").replace(/^["']|["']$/g, "") : "") || "add coupon validation to checkout";
      if (real) {
        void launchRealRun(task);
        return;
      }
      // Attached a command? `forge run` runs it in the box.
      const attachedCmd = loadForgeYaml()?.agents[0]?.command;
      if (attachedCmd) {
        launchBox(attachedCmd);
        return;
      }
      return launchRun(task);
    }
    if (cmd.special === "box") {
      const command = tokens.slice(2).join(" ").replace(/^["']|["']$/g, "");
      if (!command) return pushResult(line, [{ text: "✗ usage: forge box <command>", tone: "err" }], false);
      launchBox(command);
      return;
    }

    try {
      if (cmd.subcommands?.length) {
        const sub = cmd.subcommands.find((s) => s.name === tokens[2]);
        if (!sub) {
          return pushResult(line, [{ text: `✗ ${cmd.name}: pick a subcommand — ${cmd.subcommands.map((s) => s.name).join(", ")}`, tone: "err" }], false);
        }
        if (sub.form && tokens.length === 3) return enterForm(`forge ${cmd.name} ${sub.name}`, sub.form, sub.run);
        pushResult(line, (await sub.run(tokens.slice(3))).lines, true);
      } else {
        if (cmd.form && tokens.length === 2) return enterForm(`forge ${cmd.name}`, cmd.form, cmd.run!);
        pushResult(line, (await cmd.run!(tokens.slice(2))).lines, true);
      }
    } catch (e) {
      pushResult(line, [{ text: `✗ error: ${String(e)}`, tone: "err" }], false);
    }
  }

  const recallHistory = (dir: -1 | 1) => {
    if (history.length === 0) return;
    if (dir === -1) {
      const i = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(i);
      setLine(history[i]);
    } else {
      if (histIdx < 0) return;
      const i = histIdx + 1;
      if (i >= history.length) {
        setHistIdx(-1);
        setLine("");
      } else {
        setHistIdx(i);
        setLine(history[i]);
      }
    }
  };

  useInput(
    (chars, key) => {
      if (key.ctrl && chars === "c") return exit();
      if (key.escape) return setLine("");
      if (key.tab) {
        if (sug.items.length > 0) {
          setLine(applyCompletion(input, sug.items[selClamped].token));
          setSel(0);
        }
        return;
      }
      if (key.upArrow) {
        if (sug.items.length > 0) setSel((n) => Math.max(0, n - 1));
        else recallHistory(-1);
        return;
      }
      if (key.downArrow) {
        if (sug.items.length > 0) setSel((n) => Math.min(sug.items.length - 1, n + 1));
        else recallHistory(1);
        return;
      }
      if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
      if (key.rightArrow) return setCursor((c) => Math.min(input.length, c + 1));
      if (key.return) {
        if (isExecutable(input)) void execute(input);
        else if (sug.items.length > 0) {
          setLine(applyCompletion(input, sug.items[selClamped].token));
          setSel(0);
        } else void execute(input);
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setInput(input.slice(0, cursor - 1) + input.slice(cursor));
          setCursor((c) => c - 1);
          setSel(0);
        }
        return;
      }
      if (chars && !key.ctrl && !key.meta) {
        setInput(input.slice(0, cursor) + chars + input.slice(cursor));
        setCursor((c) => c + chars.length);
        setSel(0);
        setHistIdx(-1);
      }
    },
    { isActive: mode === "shell" }
  );

  if (mode === "run" && runRef.current) {
    return <RunView engine={runRef.current.engine} config={runRef.current.config} onExit={exitRun} />;
  }
  if (mode === "guide") return <GuideView onExit={() => setMode("shell")} />;
  if (mode === "form" && form) {
    return <FormView title={form.prefix} fields={form.fields} onComplete={completeForm} onCancel={cancelForm} />;
  }

  // ── layout sizing (edge-divider bars) ──────────────────────────────
  const paletteH = sug.items.length > 0 ? Math.min(8, sug.items.length) + 3 : sug.context === "args" && sug.argHint ? 1 : 0;
  const bodyH = Math.max(6, rows - 2 /*topbar*/ - paletteH - 2 /*cmd*/ - 2 /*status*/);
  const maxLines = Math.max(3, bodyH - 1);
  const shownLines = flattenTranscript(entries).slice(-maxLines);

  const before = input.slice(0, cursor);
  const cursorChar = input.slice(cursor, cursor + 1) || " ";
  const after = input.slice(cursor + 1);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {/* Topbar — bottom divider only */}
      <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor={theme.border} paddingX={1} justifyContent="space-between">
        <Text>
          <Text color={theme.brand} bold>{MARK} FORGE</Text>
          <Text color={theme.sep}>{"   │   "}</Text>
          <Text color={theme.textSoft}>{ws ? ws.project : "no project"}</Text>
        </Text>
        {ws ? (
          <Text>
            <Text color={theme.label}>{ws.mode}</Text>
            <Text color={theme.sep}>{"  ·  "}</Text>
            <Text color={theme.label}>{ws.policy}</Text>
            <Text color={theme.sep}>{"  ·  "}</Text>
            <Text color={theme.label}>{`${ws.runs} runs`}</Text>
          </Text>
        ) : (
          <Text color={theme.label}>type forge init to begin</Text>
        )}
      </Box>

      {/* Body — sidebar (right divider) + activity */}
      <Box height={bodyH} flexDirection="row">
        <Box width={30} borderStyle="single" borderTop={false} borderBottom={false} borderLeft={false} borderColor={theme.border} paddingX={1} paddingTop={1} flexDirection="column">
          <Text color={theme.label}>SETUP</Text>
          <Box marginTop={1} flexDirection="column">
            <Checklist steps={steps} />
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.label}>WORKSPACE</Text>
            <StatRow label="db" value={ws?.db ?? "none"} color={ws && ws.db !== "none" ? theme.info : theme.faint} />
            <StatRow label="mocks" value={ws?.mocks ?? "none"} color={ws && ws.mocks !== "none" ? theme.info : theme.faint} />
            <StatRow label="agent" value={ws?.agent ?? "none"} color={ws && ws.agent !== "none" ? theme.info : theme.faint} />
          </Box>
        </Box>

        <Box flexGrow={1} paddingX={1} paddingTop={1} flexDirection="column">
          {shownLines}
        </Box>
      </Box>

      {/* Autocomplete palette */}
      {sug.items.length > 0 ? (
        <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
          <Text>
            <Text color={theme.accent}>forge</Text>
            <Text color={theme.dim}>{"  — commands"}</Text>
          </Text>
          {sug.items.slice(0, 8).map((it, i) => (
            <Box key={it.token} justifyContent="space-between">
              <Text backgroundColor={i === selClamped ? theme.sel : undefined} color={i === selClamped ? theme.accent : theme.info}>
                {(i === selClamped ? "▸ " : "  ") + "forge " + it.token}
              </Text>
              <Text color={theme.dim}>{it.summary}</Text>
            </Box>
          ))}
        </Box>
      ) : sug.context === "args" && sug.argHint ? (
        <Box paddingX={1}>
          <Text color={theme.dim}>{sug.argHint}</Text>
        </Box>
      ) : null}

      {/* Command bar — top divider */}
      <Box borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor={theme.border} paddingX={1}>
        <Text color={theme.accent}>{"› "}</Text>
        <Text color={theme.text}>{before}</Text>
        <Text backgroundColor={theme.accent} color="#0d0c0b">{cursorChar}</Text>
        <Text color={theme.text}>{after}</Text>
      </Box>

      {/* Status bar — fainter top divider */}
      <Box borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor={theme.borderFaint} paddingX={1} justifyContent="space-between">
        <Text>
          <Text color={theme.navKey}>⏎</Text>
          <Text color={theme.faint}> run/next{"     "}</Text>
          <Text color={theme.accent}>Tab</Text>
          <Text color={theme.faint}> complete{"     "}</Text>
          <Text color={theme.navKey}>↑↓</Text>
          <Text color={theme.faint}> history{"     "}</Text>
          <Text color={theme.accent}>forge guide</Text>
          <Text color={theme.faint}> help</Text>
        </Text>
        <Text>
          <Text color={theme.block}>Ctrl-C</Text>
          <Text color={theme.faint}> exit</Text>
        </Text>
      </Box>
    </Box>
  );
}
