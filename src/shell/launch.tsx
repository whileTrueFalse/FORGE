// Entry point for the interactive Forge shell (launched by bare `forge`).
// Takes over the terminal with the alternate screen buffer (like vim / lazygit)
// so the shell renders full-screen and the user's scrollback is restored on exit.

import { render } from "ink";
import { Shell } from "./Shell.js";

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";

export async function launchShell(): Promise<void> {
  if (!process.stdout.isTTY) {
    console.error("forge: the interactive shell needs a terminal. Use `forge <command>` for one-shot / CI usage.");
    process.exitCode = 1;
    return;
  }

  process.stdout.write(ENTER_ALT_SCREEN);
  const restore = () => process.stdout.write(LEAVE_ALT_SCREEN);
  process.on("exit", restore);

  const app = render(<Shell />);
  try {
    await app.waitUntilExit();
  } finally {
    process.off("exit", restore);
    restore();
  }
}
