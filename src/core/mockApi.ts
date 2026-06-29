// Static mock API preset definitions. See docs/02-ARCHITECTURE.md §3
// ("forge mock add") and docs/05-CLI-UX-SPEC.md for expected output.
//
// v0 does not run a real HTTP server for these — they exist as registered
// metadata that the policy engine (core/policyEngine.ts) references when
// deciding whether an outbound HTTP call should be redirected to a mock.
// A real implementation could later spin up an actual `http.createServer`
// per preset without changing this module's public shape much.

import type { MockApiPreset } from "../types.js";

const PRESETS: Record<string, MockApiPreset> = {
  stripe: {
    service: "stripe",
    preset: "ecommerce",
    scenarios: ["success", "declined", "expired"],
    description: "Mock Stripe API: charges, refunds, webhooks, card failure scenarios",
  },
  sendgrid: {
    service: "sendgrid",
    preset: "email",
    capture: true,
    description: "Mock SendGrid API: captures outbound emails instead of sending them",
  },
  twilio: {
    service: "twilio",
    preset: "sms",
    capture: true,
    description: "Mock Twilio API: captures outbound SMS instead of sending them",
  },
};

export function getPreset(service: string): MockApiPreset | null {
  return PRESETS[service.toLowerCase()] ?? null;
}

export function listPresets(): MockApiPreset[] {
  return Object.values(PRESETS);
}

export function isKnownService(service: string): boolean {
  return service.toLowerCase() in PRESETS;
}
