// Drives real traffic at the running target app and tallies pass/fail into a
// SimResult. A session fails when any request returns a server error (5xx); the
// failing persona and reason emerge from real responses (e.g. the sample app's
// expired-card + coupon bug). Volume is sampled — rates are real, displayed
// session totals are extrapolated. See docs/09-ENGINE-ARCHITECTURE.md §8.

import { randomUUID } from "node:crypto";
import { buildJourney, pickPersona } from "./personas.js";
import type { Persona, SimFile, SimResult, SimulationRef } from "../../types.js";

export interface DriveOptions {
  baseUrl: string;
  sampleCap?: number;
  rand?: () => number;
  onProgress?: (done: number, total: number) => void;
}

interface SessionOutcome {
  ok: boolean;
  persona: string;
  reason?: string;
}

async function runSession(baseUrl: string, persona: Persona, rand: () => number): Promise<SessionOutcome> {
  const sessionId = randomUUID(); // correlates the journey's requests + is a valid uuid for the schema
  const journey = buildJourney(persona, rand);
  for (const req of journey) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${req.path}`, {
        method: req.method,
        headers: { "content-type": "application/json", "x-session": sessionId },
        body: req.body ? JSON.stringify(req.body) : undefined,
      });
    } catch (e) {
      return { ok: false, persona: persona.type, reason: `request failed: ${String(e)}` };
    }
    if (res.status >= 500) {
      let reason = `server error (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        reason = body.error ?? body.message ?? reason;
      } catch {
        /* non-JSON body */
      }
      return { ok: false, persona: persona.type, reason };
    }
  }
  return { ok: true, persona: persona.type };
}

export async function driveSim(sim: SimulationRef, simFile: SimFile | null, opts: DriveOptions): Promise<SimResult> {
  const rand = opts.rand ?? Math.random;
  const personas: Persona[] = simFile?.personas?.length ? simFile.personas : [{ type: sim.name, weight: 1 }];
  const total = sim.sessions;
  const sample = Math.max(1, Math.min(opts.sampleCap ?? 300, total));

  let passed = 0;
  const failsByPersona = new Map<string, { count: number; reason: string }>();

  for (let i = 0; i < sample; i++) {
    const persona = pickPersona(personas, rand);
    const outcome = await runSession(opts.baseUrl, persona, rand);
    if (outcome.ok) passed += 1;
    else {
      const cur = failsByPersona.get(outcome.persona) ?? { count: 0, reason: outcome.reason ?? "failed" };
      failsByPersona.set(outcome.persona, { count: cur.count + 1, reason: outcome.reason ?? cur.reason });
    }
    opts.onProgress?.(i + 1, sample);
  }

  const passRate = passed / sample;
  const passedSessions = Math.round(total * passRate);

  // The persona responsible for the most failures drives the report headline.
  let failingPersona: string | undefined;
  let failureReason: string | undefined;
  let worst = 0;
  for (const [persona, info] of failsByPersona) {
    if (info.count > worst) {
      worst = info.count;
      failingPersona = persona;
      failureReason = info.reason;
    }
  }

  return {
    name: sim.name,
    totalSessions: total,
    passedSessions,
    failedSessions: total - passedSessions,
    failureReason,
    failingPersona,
    assertions: simFile?.assertions,
    personas: personas.map((p) => p.type),
  };
}
