// `forge login` — drives GitHub's own OAuth Device Flow directly
// (github.com/login/device); the CLI never sends a GitHub client secret
// anywhere (device flow is public-client-safe by design). Once we hold a
// GitHub access token, we exchange it with the Forge backend for a Forge
// session -- the backend re-verifies identity itself and never trusts a
// client-supplied login. See forge-backend/src/routes/auth.ts.

import open from "open";
import ora from "ora";
import * as ui from "../core/ui.js";
import { saveCredentials } from "../core/userConfig.js";
import { FORGE_API_URL, FORGE_GITHUB_CLIENT_ID } from "../core/accountsConfig.js";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}
interface TokenResponse {
  access_token?: string;
  error?: string;
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: FORGE_GITHUB_CLIENT_ID, scope: "read:user" }),
  });
  if (!res.ok) throw new Error(`GitHub device code request failed (${res.status})`);
  return (await res.json()) as DeviceCodeResponse;
}

export async function pollForAccessToken(deviceCode: string, intervalSec: number, expiresInSec: number): Promise<string> {
  const deadline = Date.now() + expiresInSec * 1000;
  let interval = intervalSec;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: FORGE_GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const body = (await res.json()) as TokenResponse;
    if (body.access_token) return body.access_token;
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (body.error === "expired_token") throw new Error("the login code expired — run `forge login` again");
    if (body.error === "access_denied") throw new Error("login was denied");
    throw new Error(`GitHub token exchange failed: ${body.error ?? "unknown error"}`);
  }
  throw new Error("timed out waiting for login approval");
}

export async function login(): Promise<void> {
  console.log();
  let device: DeviceCodeResponse;
  try {
    device = await requestDeviceCode();
  } catch (err) {
    ui.errorBox("could not start login", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  ui.heading("Sign in to Forge");
  ui.plain(`  First copy your code: ${device.user_code}`);
  ui.plain(`  Then visit: ${device.verification_uri_complete ?? device.verification_uri}`);
  console.log();

  await open(device.verification_uri_complete ?? device.verification_uri).catch(() => {
    ui.dim("  (couldn't open a browser automatically — visit the URL above manually)");
  });

  const spinner = ora("waiting for approval in the browser...").start();
  let githubToken: string;
  try {
    githubToken = await pollForAccessToken(device.device_code, device.interval, device.expires_in);
    spinner.succeed("approved on GitHub");
  } catch (err) {
    spinner.fail(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const exchangeSpinner = ora("signing in to Forge...").start();
  try {
    const res = await fetch(`${FORGE_API_URL}/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubAccessToken: githubToken }),
    });
    const body = (await res.json()) as { cliToken?: string; githubLogin?: string; tier?: string; error?: string };
    if (!res.ok || !body.cliToken) {
      exchangeSpinner.fail(
        res.status === 403
          ? `${body.error ?? "not on the alpha allowlist"} — ask to be added, then try again`
          : (body.error ?? `sign-in failed (${res.status})`)
      );
      process.exitCode = 1;
      return;
    }
    saveCredentials({
      cliToken: body.cliToken,
      githubLogin: body.githubLogin ?? "unknown",
      tier: body.tier ?? "free",
      cachedAt: new Date().toISOString(),
    });
    exchangeSpinner.succeed(`signed in as ${body.githubLogin} · ${body.tier} tier`);
  } catch (err) {
    exchangeSpinner.fail(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
