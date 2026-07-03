// Headless smoke tests for the interactive shell. ink-testing-library lets us
// type into the command bar and inspect the rendered frame without a real TTY.

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "ink-testing-library";
import { Shell } from "./Shell.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("shell: banner renders and typing `forge` shows command suggestions", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await delay(60);
  stdin.write("forge");
  await delay(60);
  const f = lastFrame() ?? "";
  assert.match(f, /forge init/);
  assert.match(f, /forge run/);
  unmount();
});

test("shell: `forge help` executes and prints the command list", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await delay(60);
  stdin.write("forge help");
  await delay(40);
  stdin.write("\r");
  await delay(80);
  const f = lastFrame() ?? "";
  assert.match(f, /forge exit/); // command list renders (bottom is visible after clipping)
  unmount();
});

test("shell: `forge db` completes to its subcommands", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await delay(60);
  stdin.write("forge db");
  await delay(40);
  stdin.write("\r"); // not executable → completes to "forge db "
  await delay(60);
  const f = lastFrame() ?? "";
  assert.match(f, /link/);
  assert.match(f, /status/);
  unmount();
});

test("shell: first run shows the setup checklist with a next step", async () => {
  const { lastFrame, unmount } = render(<Shell />);
  await delay(60);
  const f = lastFrame() ?? "";
  assert.match(f, /setup/i); // sidebar panel (title is uppercased)
  assert.match(f, /project/); // checklist step
  assert.match(f, /next step/);
  unmount();
});

test("shell: `forge db link` opens a guided form", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await delay(60);
  stdin.write("forge db link");
  await delay(40);
  stdin.write("\r");
  await delay(80);
  const f = lastFrame() ?? "";
  assert.match(f, /connection string/);
  assert.match(f, /step 1/);
  unmount();
});

test("shell: `forge target` completes to set / show", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await delay(60);
  stdin.write("forge target");
  await delay(40);
  stdin.write("\r"); // not executable → completes, shows subcommands
  await delay(60);
  const f = lastFrame() ?? "";
  assert.match(f, /set/);
  assert.match(f, /show/);
  unmount();
});

test("shell: `forge run --real` without a project errors clearly", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await delay(60);
  stdin.write("forge run --real");
  await delay(40);
  stdin.write("\r");
  await delay(80);
  const f = lastFrame() ?? "";
  assert.match(f, /no project|no target/);
  unmount();
});

test("shell: `forge guide` opens the user guide", async () => {
  const { lastFrame, stdin, unmount } = render(<Shell />);
  await delay(60);
  stdin.write("forge guide");
  await delay(40);
  stdin.write("\r");
  await delay(80);
  const f = lastFrame() ?? "";
  assert.match(f, /guided tour/);
  assert.match(f, /What Forge is/);
  unmount();
});
