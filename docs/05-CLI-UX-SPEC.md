# CLI UX Spec — Exact Expected Output

This doc specifies the literal expected terminal output for each command, so
the implementation has a concrete target rather than vague "make it look
nice" guidance. Treat these as close targets, not pixel-perfect contracts —
reasonable formatting deviations are fine, but the **content, sequence, and
tone** should match.

## Conventions

- `✓` green for pass/success lines.
- `⚠` yellow/amber for warnings/intercepts.
- `✗` red for blocks/failures.
- `ℹ` blue for informational notes.
- Dim gray for secondary/explanatory sub-lines.
- Use `chalk` for coloring, `ora` for the few multi-second "working" spinners,
  `boxen` for the final run summary panel.
- Pace streamed log lines with realistic delays (roughly 150–600ms between
  lines) using a `sleep(ms)` helper — except when output is piped/non-TTY,
  in which case skip delays entirely (check `process.stdout.isTTY`).

## Free-flow & shell modes

Forge does not force a setup wizard. The only required step is `forge init`;
`db link`, `mock add`, `sim add`, and `attach` are **optional** and may be run
in any order. A run needs no attached agent — when none is present Forge uses a
full-scope (`**`) default so nothing blocks the run. The one guardrail that
stays is inherent: `forge run --real` needs a `target` app to drive.

The zero-setup entry point is the box:

```
$ forge init acme-checkout
$ forge box "npm test"        # runs sandboxed immediately — no db/mock/attach
```

The interactive shell has two modes, toggled with `forge mode`:

```
$ forge mode              # show the current mode
mode: guided
  guided — setup checklist + next-step hints on the left

$ forge mode free         # hide the checklist for full control
✓ mode → free
```

`guided` (default) shows the setup checklist and next-step hints; `free` hides
them. The choice persists per project in `.forge/state.json` (`shellMode`).

## `forge init`

```
$ forge init

? project name: acme-checkout
? stack (free text, just a label): Node.js + PostgreSQL + Redis
? policy preset: (default/strict) default

✓ forge.yaml created
✓ .forge/ directory scaffolded

run anything now: forge box "<command>"  ·  or wire connectors: forge db link
```

## `forge db link`

```
$ forge db link postgres://localhost:5432/acme_prod --sim-only

  reading schema from acme_prod...
✓ 5 tables, 12 indexes detected
✓ schema snapshot saved → .forge/schema.json
⚠ no prod data copied — sim engine will generate synthetic rows

  generating 50,000 synthetic rows matching schema distributions...
✓ sim database ready → forge-sim://acme-checkout
```

Table/index counts should come from whatever fake schema `core/simDb.ts`
defines (see `02-ARCHITECTURE.md` — the fixed e-commerce schema:
`users`, `orders`, `order_items`, `coupons`, `sessions`). Counts must be
real (i.e. actually computed from the fake schema definition, not hardcoded
strings), so they stay consistent if the schema changes later.

## `forge mock add`

```
$ forge mock add stripe --preset ecommerce

✓ stripe mock registered (preset: ecommerce)
  scenarios: success, declined, expired
```

```
$ forge mock add sendgrid --preset email

✓ sendgrid mock registered (preset: email)
  mode: capture (emails logged, never sent)
```

## `forge sim add`

```
$ forge sim add --file ./sims/checkout-flow.yaml

✓ simulation loaded: "checkout-flow" (declarative)
  4 personas · 12,000 sessions
```

```
$ forge sim add --user-type expired_card_with_coupon --count 500

✓ simulation created: "edge-cases"
  persona: expired_card_with_coupon · 500 sessions
  saved → .forge/sims/edge-cases.yaml
```

## `forge attach`

```
$ forge attach cursor --scope ./src/checkout/**

✓ cursor attached
  scope: ./src/checkout/**
  env: sandbox (sim db + mocks injected automatically)

watch live:  forge log --follow
run now:     forge run
```

## `forge run` (the centerpiece — full sequence)

```
$ forge run --task "add coupon validation to checkout"

── forge run #14 ──────────────────────────────
  agent:  cursor
  scope:  ./src/checkout/**
  task:   add coupon validation to checkout
────────────────────────────────────────────────

  agent writing: checkout.service.ts
✓ SELECT id, total FROM orders WHERE user_id = ?      [pass]
✓ INSERT INTO orders (...)                            [pass]
⚠ UPDATE orders SET status = ?                        [intercept]
   reason: missing WHERE clause
   rewrite: UPDATE orders SET status = ? WHERE id = ? AND user_id = ?
✓ agent applied rewrite

  agent writing: coupon.validator.ts
✗ SELECT * FROM users                                 [BLOCKED]
   reason: wildcard select exposes PII fields (email, phone, address)
   policy: only allowed fields — id, email_hash, tier
✓ agent rewrote: SELECT id, email_hash, tier FROM users
✓ agent applied rewrite

  running simulation: checkout-flow (12,000 sessions)
  [progress ramps — see note below]
✓ 11,843 / 12,000 sessions passed

  running simulation: edge-cases (500 sessions)
⚠ 343 / 500 sessions passed
  157 failed — persona: expired_card_with_coupon
  cause: no error handling for expired card + active coupon combination

── run #14 complete ───────────────────────────
  files changed:     2
  policy intercepts: 1 (auto-rewritten)
  policy blocks:     1 (auto-rewritten)
  sim pass rate:     93.2%

  ⚠ requires attention: expired card + coupon edge case unhandled

  next steps:
    forge diff run-14       view the code changes
    forge approve run-14    approve this run
────────────────────────────────────────────────
```

Notes:
- "progress ramps" — for the 12,000-session sim, print 2-3 intermediate
  lines with increasing counts before the final tally, e.g.:
  ```
    ...3,204 / 12,000
    ...8,991 / 12,000
  ✓ 11,843 / 12,000 sessions passed
  ```
  using `\r`-based line overwrite if TTY, or sequential lines if not.
- The exact numbers should come from deterministic-but-randomized logic in
  the runner (see `07-FAKE-AGENT-SPEC.md`), not hardcoded — but the *shape*
  of the output (one sim passing cleanly above ~98%, one sim showing a
  meaningful partial failure tied to a named edge case) should always hold so
  the demo reliably tells the intended story.
- If `--exit-on-block` is passed and a block was **not** auto-resolved
  (reserved for future policy configs where `on_block: stop_run`), the
  process should exit with code `1`. In the default `on_block: notify_agent`
  flow shown above, blocks are always followed by a successful agent
  rewrite, so exit code is `0`.

## `forge log --follow`

```
$ forge log --follow

  streaming run-14 (replay — no live process in v0)...
[same event sequence as above, replayed with pacing]
```

## `forge diff`

```
$ forge diff run-14

  src/checkout/checkout.service.ts | +18 -6
─────────────────────────────────────────────
  41   async function processCheckout(userId, cartId, couponCode?) {
  42     const cart = await db.query(
- 43       'SELECT * FROM carts WHERE id = ?', [cartId]
+ 43       'SELECT id, items, total, user_id FROM carts WHERE id = ? AND user_id = ?', [cartId, userId]
  44     );
  ...

  src/checkout/coupon.validator.ts | +38 -0  (new file)
─────────────────────────────────────────────
+  1   import { db } from '../db';
+  2   import { CouponError } from '../errors';
  ...
```

Use `-` lines in red, `+` lines in green, unchanged context lines dim.

## `forge approve`

Success case:
```
$ forge approve run-14

  run-14 summary:
    sim pass rate:     93.2%   (threshold: 95% — see note)
    policy blocks:     1 (auto-resolved)

✗ cannot approve: sim pass rate 93.2% is below required 95%
  fix the failing edge case, or re-run with --force to override

  forge run --task "fix expired card + coupon handling"
```

Forced override:
```
$ forge approve run-14 --force

⚠ forcing approval despite pass rate 93.2% (below 95% threshold)
✓ run-14 approved by you @ 2026-06-20T11:42:03Z
  recorded in .forge/runs/run-14.json
```

If `forge.yaml` has no integrations connected, stop there. If connected
(`mode: ci` or `mode: cd`), append:
```
ℹ github integration connected — would post run-14 report as a PR check
  (simulated only in this prototype — no network call made)
```

## `forge connect` / `forge disconnect`

```
$ forge connect github

✓ (simulated) github app would be installed on this repo
✓ forge.yaml updated: mode → ci
  integrations.github added

  forge will now (in a real deployment) post run reports as PR checks
```

```
$ forge disconnect github

✓ github integration removed
✓ forge.yaml updated: mode → sandbox
```

## General Error Handling Tone

Errors should be calm and instructive, never just a stack trace:

```
$ forge run

✗ no agent attached
  run `forge attach <agent> --scope <glob>` first
```

```
$ forge approve run-99

✗ run-99 not found
  available runs: run-14, run-13, run-12
  (forge run --help for usage)
```
