// In-shell user guide. Reuses the standalone TUI's tour content as a navigable
// stepper; Esc/q returns to the shell.

import { useState } from "react";
import { useInput } from "ink";
import { Tour, TOUR_STEPS } from "../tui/Tour.js";

export function GuideView({ onExit }: { onExit: () => void }): React.JSX.Element {
  const [step, setStep] = useState(0);

  useInput((input, key) => {
    if (input === "q" || key.escape) return onExit();
    if (key.leftArrow) setStep((n) => Math.max(0, n - 1));
    else if (key.rightArrow || key.return) {
      if (step >= TOUR_STEPS.length - 1) onExit();
      else setStep((n) => n + 1);
    }
  });

  return <Tour step={step} lastAction="close guide" escAction="close" />;
}
