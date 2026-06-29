// Turns a declarative persona into a concrete HTTP journey the sim driver fires
// at the target app. Pure + deterministic given an injected RNG, so it's
// unit-testable. See docs/09-ENGINE-ARCHITECTURE.md §8.

import type { Persona, PersonaAttributeValue } from "../../types.js";

export interface SimRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}

type Rand = () => number;

function num(v: PersonaAttributeValue | undefined, rand: Rand, fallback: number): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "min" in v && "max" in v) {
    return v.min + Math.floor(rand() * (v.max - v.min + 1));
  }
  return fallback;
}

function pick(v: PersonaAttributeValue | undefined, rand: Rand, fallback: string): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return String(v[Math.floor(rand() * v.length)]);
  return fallback;
}

function bool(v: PersonaAttributeValue | undefined, rand: Rand, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v && typeof v === "object" && "probability" in v) return rand() < v.probability;
  return fallback;
}

/** Build the checkout journey for a persona: add to cart → (coupon) → payment → checkout. */
export function buildJourney(persona: Persona, rand: Rand = Math.random): SimRequest[] {
  const attrs = persona.attributes ?? {};
  const cartSize = num(attrs.cart_size, rand, 1);
  const paymentMethod = pick(attrs.payment_method, rand, "card");
  const hasCoupon = bool(attrs.has_coupon, rand, false);
  const cardStatus = pick(attrs.card_status, rand, "valid");

  const journey: SimRequest[] = [
    { method: "POST", path: "/cart", body: { items: cartSize, payment_method: paymentMethod } },
  ];
  if (hasCoupon) journey.push({ method: "POST", path: "/coupon", body: { code: "SAVE10" } });
  journey.push({ method: "POST", path: "/payment", body: { card_status: cardStatus } });
  journey.push({ method: "POST", path: "/checkout", body: {} });
  return journey;
}

/** Pick a persona index by weight using the injected RNG. */
export function pickPersona(personas: Persona[], rand: Rand = Math.random): Persona {
  const total = personas.reduce((s, p) => s + (p.weight ?? 0), 0) || personas.length;
  let r = rand() * total;
  for (const p of personas) {
    r -= p.weight ?? 1;
    if (r <= 0) return p;
  }
  return personas[personas.length - 1];
}
