// Mounts the live dashboard for a `forge run` issued inside the shell, then
// hands control back to the shell when the user presses q. Reuses the shared
// useRunState hook + Dashboard component, so this is the same cockpit the
// standalone `forge tui` shows.

import { useEffect, useRef } from "react";
import { useInput } from "ink";
import { Dashboard } from "../tui/Dashboard.js";
import { useRunState } from "../tui/useRunState.js";
import type { RunSource } from "../core/runEngine.js";
import type { ForgeConfig } from "../types.js";

export function RunView({
  engine,
  config,
  onExit,
}: {
  engine: RunSource;
  config: ForgeConfig;
  onExit: () => void;
}): React.JSX.Element {
  const run = useRunState(engine);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run.start();
  }, []);

  useInput((input, key) => {
    if (input === "q" || key.escape || (key.ctrl && input === "c")) onExit();
  });

  return (
    <Dashboard
      config={config}
      header={run.header}
      log={run.log}
      stats={run.stats}
      sims={run.sims}
      passRate={run.passRate}
      phase={run.phase}
      elapsedMs={run.elapsedMs}
    />
  );
}
