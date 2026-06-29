// Plain-mode orchestrator for `forge run`. Wires the shared RunEngine to the
// line-by-line terminal renderer. The TUI (src/tui/) attaches its own renderer
// to the same engine. See docs/02-ARCHITECTURE.md §5.

import { RunEngine, type RunOptions, type RunOutcome } from "./runEngine.js";
import { attachPlainRenderer } from "./plainRenderer.js";

export type { RunOptions, RunOutcome } from "./runEngine.js";

export async function executeRun(opts: RunOptions): Promise<RunOutcome> {
  const engine = new RunEngine(opts);
  attachPlainRenderer(engine);
  return engine.run();
}
