#!/usr/bin/env node
// Thin launcher so `npm link` exposes a stable `forge` binary that runs the
// compiled CLI. Build first (`npm run build`, or the `prepare` script) so
// dist/cli.js exists. Importing it triggers commander's parseAsync.
import "../dist/cli.js";
