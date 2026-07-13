// Guided tour for `forge tui` — a step-through explainer of what Forge does
// and what each dashboard panel shows. Navigation is driven by App (centralized
// input); this component is presentational and renders the current step.

import { Box, Text } from "ink";
import { Panel, SectionTitle, KeyBar, theme } from "./components.js";

export interface TourStep {
  title: string;
  body: string[];
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "What Forge is",
    body: [
      "Forge sits between an AI coding agent and the real world.",
      "The agent runs against a synthetic database and mock APIs —",
      "never your production systems. Every action is inspected before",
      "it is allowed to have any effect.",
    ],
  },
  {
    title: "Running it  (free-flow)",
    body: [
      'No fixed setup. `forge box "<command>"` runs anything in the',
      "sandbox right after `forge init` — database, mocks, and write",
      "scope all default. Add connectors only if you want them, in any",
      "order: forge db link · forge mock add · forge attach.",
      "Want the checklist? `forge mode guided`. Out of the way? `forge mode free`.",
    ],
  },
  {
    title: "Connectors  (left)",
    body: [
      "Shows what the sandbox stands in for: a synthetic DB seeded from",
      "your schema shape (no real rows copied) and mock third-party APIs",
      "(Stripe, SendGrid…). Outbound calls are redirected here, so no",
      "real charges or emails ever happen.",
    ],
  },
  {
    title: "Live Policy Log  (center)",
    body: [
      "The heart of a run. Each operation the agent attempts is evaluated:",
      "  ✓ pass       — safe, allowed through",
      "  ⚠ intercept  — unsafe but fixable; auto-rewritten, agent continues",
      "  ✗ block      — unsafe; agent is told why and self-corrects",
      "You see the reason and the rewrite for every intervention.",
    ],
  },
  {
    title: "Run Metrics  (right)",
    body: [
      "Running totals: intercepts, blocks, and auto-resolved corrections.",
      "The pass rate is the average across all simulations and is gated",
      "against your approval threshold — the bar turns green only when",
      "the run is eligible to approve.",
    ],
  },
  {
    title: "Simulations  (right)",
    body: [
      "Each registered sim runs many synthetic sessions against the change.",
      "A large happy-path sim usually passes high; a small edge-case sim",
      "is designed to surface a specific failure (e.g. expired card +",
      "coupon) so a real bug can't hide behind volume.",
    ],
  },
  {
    title: "The approval gate",
    body: [
      "After a run: `forge diff` to view changes, `forge report` for the",
      "full readable report, `forge approve` to sign off. Approval is",
      "refused below the pass-rate threshold unless you pass --force.",
      "Dev stays in control — nothing graduates to CI/CD silently.",
    ],
  },
];

export function Tour({
  step,
  lastAction = "start run",
  escAction = "skip to start",
}: {
  step: number;
  lastAction?: string;
  escAction?: string;
}): React.JSX.Element {
  const s = TOUR_STEPS[step];
  const last = TOUR_STEPS.length - 1;
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Text color={theme.brand} bold>
        ◆ FORGE · guided tour
      </Text>
      <Box marginTop={1} width={76}>
        <Panel title={`Step ${step + 1} / ${TOUR_STEPS.length}`} flexGrow={1} minHeight={11}>
          <SectionTitle>{s.title}</SectionTitle>
          <Box flexDirection="column" marginTop={1}>
            {s.body.map((line, i) => (
              <Text key={i} color={line.includes("✓") || line.includes("⚠") || line.includes("✗") ? undefined : theme.dim}>
                {line}
              </Text>
            ))}
          </Box>
        </Panel>
      </Box>
      <Box marginTop={1}>
        <KeyBar
          hints={[
            { keyLabel: "→/⏎", action: step === last ? lastAction : "next" },
            { keyLabel: "←", action: "back" },
            { keyLabel: "Esc", action: escAction },
            { keyLabel: "q", action: "quit" },
          ]}
        />
      </Box>
    </Box>
  );
}
