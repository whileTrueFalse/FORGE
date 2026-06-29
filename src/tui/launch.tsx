// Mounts the Ink dashboard for a run and resolves once the run is complete and
// the user has quit. The App component owns starting the engine (so its event
// subscriptions are attached before any event fires).

import { render } from "ink";
import { App } from "./App.js";
import { RunEngine, type RunOptions, type RunOutcome } from "../core/runEngine.js";

export async function launchTui(opts: RunOptions): Promise<RunOutcome> {
  const engine = new RunEngine(opts);
  const donePromise = new Promise<RunOutcome>((resolve) => {
    engine.once("done", (outcome) => resolve(outcome as RunOutcome));
  });

  const app = render(<App engine={engine} config={opts.config} task={opts.task} />);
  const outcome = await donePromise;
  // Keep the final frame on screen until the user presses q / Ctrl-C.
  await app.waitUntilExit();
  return outcome;
}
