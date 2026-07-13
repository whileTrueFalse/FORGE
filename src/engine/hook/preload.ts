// The hook entry point, injected into the target app via
// `NODE_OPTIONS=--require <this>`. It reads its config from the environment,
// builds the policy evaluation context, installs the pg/http/fs patches, and
// reports every intercepted op back to the orchestrator over IPC.
//
// This module runs INSIDE the target app's process, before the app's own code.

import { readHookConfig, emitOp, emitLog, emitReady } from "./ipc.js";
import { installPgPatch } from "./patchPg.js";
import { installHttpPatch } from "./patchHttp.js";
import { installFetchPatch } from "./patchFetch.js";
import { installFsPatch } from "./patchFs.js";
import { buildKnownMocksMap } from "../../core/policyEngine.js";
import type { InterceptDeps } from "./intercept.js";

function main(): void {
  const config = readHookConfig();
  if (!config) {
    // Not running under forge — do nothing, let the app run normally.
    return;
  }

  const deps: InterceptDeps = {
    policy: config.policy,
    // Tell the policy engine which third-party hosts are mocked, so an outbound
    // call to a registered service is a redirect (rewrite), not a block.
    ctx: { scope: config.scope, readOnly: config.readOnly, knownMocks: buildKnownMocksMap(config.mocks) },
    emit: emitOp,
  };

  const pg = installPgPatch(deps);
  installHttpPatch(deps, config.hostRedirects);
  const fetchPatched = installFetchPatch(deps, config.hostRedirects);
  installFsPatch(deps);

  emitLog("info", `forge hook installed (pg=${pg}, fetch=${fetchPatched}, db=${config.dbUrl ? "sandbox" : "none"})`);
  // App finishes booting after this require returns; signal readiness on next tick.
  process.nextTick(emitReady);
}

main();
