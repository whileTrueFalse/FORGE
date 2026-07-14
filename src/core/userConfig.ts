// User-level (not project-level) credential store for `forge login`. Lives at
// ~/.forge/credentials.json -- deliberately separate from store.ts's
// project-local .forge/ (which is keyed off a mutable projectRoot and has no
// concept of a signed-in user). Account state must persist across projects,
// so it belongs in the home directory, not any one project.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credentialsPath = () => path.join(os.homedir(), ".forge", "credentials.json");

export interface Credentials {
  cliToken: string;
  githubLogin: string;
  /** Last known entitlement tier, cached so `forge whoami` and feature checks
   *  work offline. Refreshed opportunistically, never required to be fresh. */
  tier: string;
  cachedAt: string;
}

export function loadCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null; // not logged in, or file unreadable/corrupt -- treat as logged out
  }
}

export function saveCredentials(creds: Credentials): void {
  const dir = path.dirname(credentialsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(credentialsPath(), JSON.stringify(creds, null, 2), {
    encoding: "utf-8",
    // Best-effort: real perms enforcement on POSIX; Windows ACLs don't honor
    // this bit, so the file isn't meaningfully protected there. Documented in
    // README/SECURITY.md -- the token is server-side revocable if it leaks.
    mode: 0o600,
  });
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(credentialsPath());
  } catch {
    // already logged out -- fine
  }
}
