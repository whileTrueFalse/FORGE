// Shared hook that subscribes to a RunEngine and accumulates the live run
// state (header, policy log, metrics, sims, pass rate, elapsed clock). Used by
// both the standalone TUI (App) and the interactive shell's run view, so the
// engine→state mapping lives in exactly one place.

import { useEffect, useRef, useState } from "react";
import { theme } from "./components.js";
import { describeOp, type RunSource, type HeaderInfo, type OpEvent } from "../core/runEngine.js";
import type { PolicyStats } from "../types.js";
import type { LogLine, SimState, RunPhase } from "./Dashboard.js";

export const ICON = { pass: "✓", rewrite: "⚠", block: "✗", file: "▌" };

export function opToLines(e: OpEvent): LogLine[] {
  const label = describeOp(e.op);
  if (e.status === "pass") return [{ icon: ICON.pass, color: theme.pass, text: label }];
  if (e.status === "rewrite") {
    const subs = [`reason: ${e.reason}`];
    if (e.rewritten) subs.push(`rewrite: ${describeOp(e.rewritten)}`);
    subs.push("✓ agent applied rewrite");
    return [{ icon: ICON.rewrite, color: theme.warn, text: `${label}  [intercept]`, subs }];
  }
  const subs = [`reason: ${e.reason}`];
  if (e.stopped) subs.push("✗ run halted (on_block: stop_run)");
  else if (e.corrected) {
    subs.push(`agent rewrote: ${describeOp(e.corrected)}`);
    subs.push(e.correctedPassed ? "✓ agent applied rewrite" : "✗ correction still failed policy");
  }
  return [{ icon: ICON.block, color: theme.block, text: `${label}  [BLOCKED]`, subs }];
}

export interface RunState {
  header: HeaderInfo | null;
  log: LogLine[];
  stats: PolicyStats;
  sims: SimState[];
  passRate: number | null;
  phase: RunPhase;
  elapsedMs: number;
}

export interface UseRunState extends RunState {
  started: boolean;
  start: () => void;
}

export function useRunState(engine: RunSource): UseRunState {
  const [header, setHeader] = useState<HeaderInfo | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [stats, setStats] = useState<PolicyStats>({ intercepts: 0, blocks: 0, autoResolved: 0 });
  const [sims, setSims] = useState<SimState[]>([]);
  const [passRate, setPassRate] = useState<number | null>(null);
  const [phase, setPhase] = useState<RunPhase>("running");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [started, setStarted] = useState(false);
  const startTime = useRef(0);
  const runOnce = useRef(false);

  // Attach engine subscriptions once, before any run begins.
  useEffect(() => {
    const push = (...lines: LogLine[]) => setLog((prev) => [...prev, ...lines]);
    engine.on("header", (h) => setHeader(h));
    engine.on("file", ({ file }) => push({ icon: ICON.file, color: theme.dim, text: `writing ${file}` }));
    engine.on("op", (e) => push(...opToLines(e)));
    engine.on("stat", (s) => setStats(s));
    engine.on("sim:start", ({ name, sessions }) =>
      setSims((prev) => (prev.some((s) => s.name === name) ? prev : [...prev, { name, sessions }]))
    );
    engine.on("sim:progress", ({ name, count, total }) =>
      setSims((prev) => prev.map((s) => (s.name === name ? { ...s, count, total } : s)))
    );
    engine.on("sim:result", ({ result }) =>
      setSims((prev) => prev.map((s) => (s.name === result.name ? { ...s, result } : s)))
    );
    engine.on("done", ({ record }) => {
      setPassRate(record.report.passRate);
      setPhase("done");
    });
  }, [engine]);

  // Elapsed clock — ticks only while a run is in progress.
  useEffect(() => {
    if (!started || phase !== "running") return;
    const id = setInterval(() => setElapsedMs(Date.now() - startTime.current), 500);
    return () => clearInterval(id);
  }, [started, phase]);

  const start = () => {
    if (runOnce.current) return;
    runOnce.current = true;
    startTime.current = Date.now();
    setStarted(true);
    void engine.run().catch(() => setPhase("done"));
  };

  return { header, log, stats, sims, passRate, phase, elapsedMs, started, start };
}
