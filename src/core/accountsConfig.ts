// Public config for account/billing features (forge login/whoami/upgrade).
// These are NOT secrets: a device-flow client_id is meant to be embedded in a
// public CLI (that's the whole point of the device flow -- no client secret
// ever touches this codebase). Both are overridable via env var so the CLI
// can be pointed at a local/staging forge-backend during development.

export const FORGE_API_URL = process.env.FORGE_API_URL ?? "https://api.forge.dev";
export const FORGE_GITHUB_CLIENT_ID = process.env.FORGE_GITHUB_CLIENT_ID ?? "REPLACE_WITH_REAL_CLIENT_ID";
