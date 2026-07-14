// `forge logout` — revokes the token server-side (best-effort) and always
// clears the local credentials, even if the backend is unreachable.

import * as ui from "../core/ui.js";
import { loadCredentials, clearCredentials } from "../core/userConfig.js";
import { FORGE_API_URL } from "../core/accountsConfig.js";

export async function logout(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    ui.dim("not signed in");
    return;
  }

  try {
    await fetch(`${FORGE_API_URL}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.cliToken}` },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // best-effort — the local credentials are cleared regardless
  }

  clearCredentials();
  ui.ok(`signed out of ${creds.githubLogin}`);
}
