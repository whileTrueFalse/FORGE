// `forge whoami` — shows the signed-in account + entitlement tier. Tries a
// live check against the backend first (so the tier is fresh); falls back to
// the locally cached value on any network failure, so the command (and any
// future feature-gating that reads the cache) stays usable offline.

import * as ui from "../core/ui.js";
import { loadCredentials, saveCredentials } from "../core/userConfig.js";
import { FORGE_API_URL } from "../core/accountsConfig.js";

export async function whoami(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    ui.dim("not signed in — run `forge login`");
    return;
  }

  try {
    const res = await fetch(`${FORGE_API_URL}/me`, {
      headers: { Authorization: `Bearer ${creds.cliToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401) {
      ui.warn("your session was revoked — run `forge login` again");
      return;
    }
    if (res.ok) {
      const body = (await res.json()) as { githubLogin: string; tier: string };
      saveCredentials({ ...creds, githubLogin: body.githubLogin, tier: body.tier, cachedAt: new Date().toISOString() });
      ui.ok(`${body.githubLogin} · ${body.tier} tier`);
      return;
    }
  } catch {
    // offline or backend unreachable — fall through to the cache below
  }

  ui.ok(`${creds.githubLogin} · ${creds.tier} tier`);
  ui.dim(`  (cached — last verified ${creds.cachedAt})`);
}
