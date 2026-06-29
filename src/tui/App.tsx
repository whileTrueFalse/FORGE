// Forge standalone TUI root (used by `forge tui`). A small screen state machine
// — welcome → (tour) → run/done — that owns the run engine subscription via
// useRunState and routes keyboard input per screen.

import { Box, useApp, useInput } from "ink";
import { useRef, useState } from "react";
import { Welcome } from "./Welcome.js";
import { Tour, TOUR_STEPS } from "./Tour.js";
import { Dashboard } from "./Dashboard.js";
import { useRunState } from "./useRunState.js";
import type { RunEngine } from "../core/runEngine.js";
import type { ForgeConfig } from "../types.js";

type Screen = "welcome" | "tour" | "run";

export function App({
  engine,
  config,
  task,
}: {
  engine: RunEngine;
  config: ForgeConfig;
  task: string;
}): React.JSX.Element {
  const { exit } = useApp();
  const run = useRunState(engine);

  const [screen, setScreen] = useState<Screen>("welcome");
  const [tourStep, setTourStep] = useState(0);

  const screenRef = useRef(screen);
  const tourRef = useRef(tourStep);
  screenRef.current = screen;
  tourRef.current = tourStep;

  const startRun = () => {
    setScreen("run");
    run.start();
  };

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    const s = screenRef.current;
    if (s === "welcome") {
      if (key.return) startRun();
      else if (input === "t") {
        setTourStep(0);
        setScreen("tour");
      }
    } else if (s === "tour") {
      if (key.escape) startRun();
      else if (key.leftArrow) setTourStep((n) => Math.max(0, n - 1));
      else if (key.rightArrow || key.return) {
        if (tourRef.current >= TOUR_STEPS.length - 1) startRun();
        else setTourStep((n) => n + 1);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {screen === "welcome" ? (
        <Welcome config={config} task={task} />
      ) : screen === "tour" ? (
        <Tour step={tourStep} />
      ) : (
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
      )}
    </Box>
  );
}
