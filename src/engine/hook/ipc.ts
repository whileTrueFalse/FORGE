// Hook ↔ orchestrator IPC. The child (app under the hook) reads its config from
// an env var and reports ops/logs back to the parent via the child_process IPC
// channel (process.send). JSON, cross-platform, no sockets. See §5 of
// docs/09-ENGINE-ARCHITECTURE.md.

import type { HookConfig, HookMessage } from "../types.js";
import type { AgentOperation, PolicyVerdict } from "../../types.js";

export const HOOK_CONFIG_ENV = "FORGE_HOOK_CONFIG";

/** Read the hook config the parent serialized into the environment. */
export function readHookConfig(env: NodeJS.ProcessEnv = process.env): HookConfig | null {
  const raw = env[HOOK_CONFIG_ENV];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HookConfig;
  } catch {
    return null;
  }
}

/** Serialize a hook config for spawning a child (parent side). */
export function encodeHookConfig(config: HookConfig): string {
  return JSON.stringify(config);
}

function send(msg: HookMessage): void {
  process.send?.(msg);
}

export function emitOp(op: AgentOperation, verdict: PolicyVerdict): void {
  send({ t: "op", op, verdict });
}

export function emitLog(level: "info" | "warn" | "error", msg: string): void {
  send({ t: "log", level, msg });
}

export function emitReady(): void {
  send({ t: "ready" });
}
