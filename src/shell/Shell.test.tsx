// Headless smoke tests for the interactive shell. ink-testing-library lets us
// type into the command bar and inspect the rendered frame without a real TTY.
//
// Timing model:
//  - a short settle after render / after typing lets Ink attach + re-subscribe
//    its stdin `useInput` handler (mount/passive effects — event-loop-bound, so
//    reliable regardless of CPU speed). Pressing Enter before that re-subscribe
//    hits a stale closure and the command never runs.
//  - post-action assertions poll via waitFor (not a fixed sleep), so a slow
//    render on a shared CI runner can't race the assertion.

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "ink-testing-library";
import { Shell } from "./Shell.js";
import { waitFor } from "../testWait.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const has = (lastFrame: () => string | undefined, ...res: RegExp[]) => {
  const f = lastFrame() ?? "";
  return res.every((re) => re.test(f));
};

/** Render the shell, type a line, and (optionally) press Enter — with settles
 *  that let Ink commit the input state + re-subscribe the key handler. */
async function typeLine(stdin: { write: (s: string) => void }, line: string, enter: boolean) {
  await delay(50); // input handler attached
  stdin.write(line);
  if (enter) {
    await delay(50); // input state committed + handler re-subscribed
    stdin.write("\r");
  }
}

test("shell: banner renders and typing `forge` shows command suggestions", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await typeLine(stdin, "forge", false);
  await waitFor(() => has(lastFrame, /forge init/, /forge run/));
  unmount();
});

test("shell: `forge help` executes and prints the command list", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await typeLine(stdin, "forge help", true);
  await waitFor(() => has(lastFrame, /forge exit/)); // command list renders
  unmount();
});

test("shell: `forge db` completes to its subcommands", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await typeLine(stdin, "forge db", true); // not executable → completes to "forge db "
  await waitFor(() => has(lastFrame, /link/, /status/));
  unmount();
});

test("shell: first run shows the setup checklist with a next step", async () => {
  const { lastFrame, unmount } = render(<Shell />);
  await waitFor(() => has(lastFrame, /setup/i, /project/, /next step/));
  unmount();
});

test("shell: `forge db link` opens a guided form", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await typeLine(stdin, "forge db link", true);
  await waitFor(() => has(lastFrame, /connection string/, /step 1/));
  unmount();
});

test("shell: `forge target` completes to set / show", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await typeLine(stdin, "forge target", true); // not executable → completes, shows subcommands
  await waitFor(() => has(lastFrame, /set/, /show/));
  unmount();
});

test("shell: `forge run --real` without a project errors clearly", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await typeLine(stdin, "forge run --real", true);
  await waitFor(() => has(lastFrame, /no project|no target/));
  unmount();
});

test("shell: `forge guide` opens the user guide", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await typeLine(stdin, "forge guide", true);
  await waitFor(() => has(lastFrame, /guided tour/, /What Forge is/));
  unmount();
});
