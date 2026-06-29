# Simulation YAML Spec

A simulation file (referenced from `forge.yaml`'s `simulations[].file`, stored
under `.forge/sims/`) describes what the sandbox should throw at the agent's
code: synthetic users, data shapes, and/or specific scripted journeys.

Forge supports **two modes** in the same file format — declarative and
scripted — and a sim file may use either or both together. This matches the
product decision that scale (declarative) and behavior-accuracy (scripted)
solve different problems and shouldn't force a developer to choose.

## 1. Declarative Mode

Describes the *shape of the world* — personas, data distributions, edge-case
flags — and lets forge generate sessions against it.

```yaml
name: checkout-flow
mode: declarative

personas:
  - type: new_customer
    weight: 0.4
    attributes:
      cart_size: { min: 1, max: 5 }
      payment_method: card
  - type: returning_customer
    weight: 0.45
    attributes:
      cart_size: { min: 1, max: 12 }
      payment_method: [card, paypal, saved_card]
      has_coupon: { probability: 0.3 }
  - type: expired_card_with_coupon
    weight: 0.05
    attributes:
      payment_method: card
      card_status: expired
      has_coupon: { probability: 1.0 }
  - type: high_value_cart
    weight: 0.1
    attributes:
      cart_size: { min: 10, max: 50 }
      total_value: { min: 500, max: 5000 }

sessions: 12000
concurrency: 50

assertions:
  - "no session results in a 500-level error"
  - "no session writes to orders without a corresponding payment record"
  - "expired_card_with_coupon sessions surface a clear error message"
```

### Declarative field reference

| Field | Type | Notes |
|---|---|---|
| `name` | string | unique sim name |
| `mode` | `declarative` | |
| `personas[]` | array | each persona has a `type`, a `weight` (0-1, should sum to ~1 across personas), and free-form `attributes` |
| `attributes.*` | varies | can be a literal, a `{min, max}` numeric range, a list (randomly chosen), or a `{probability}` boolean flag |
| `sessions` | number | total sessions to simulate, distributed across personas by weight |
| `concurrency` | number | cosmetic in v0 |
| `assertions[]` | string[] | free-text assertions; in v0 these are **displayed in the report**, not actually programmatically evaluated against real execution — see `07-FAKE-AGENT-SPEC.md` for how v0 fakes pass/fail against them plausibly |

## 2. Scripted Mode

Describes a specific step-by-step journey — useful for exact edge cases that
are awkward to express as a probability distribution.

```yaml
name: expired-card-retry
mode: scripted

steps:
  - action: add_to_cart
    params: { product_id: "sku_1029", quantity: 2 }
  - action: apply_coupon
    params: { code: "SAVE10" }
  - action: enter_payment
    params: { card_status: "expired" }
  - action: submit_checkout
    expect:
      status: error
      error_code: "CARD_EXPIRED"
  - action: enter_payment
    params: { card_status: "valid" }
  - action: submit_checkout
    expect:
      status: success

repeat: 500   # run this exact script this many times (simulates 500 users
              # hitting this exact path, e.g. for race-condition/load checks)
```

### Scripted field reference

| Field | Type | Notes |
|---|---|---|
| `name` | string | unique sim name |
| `mode` | `scripted` | |
| `steps[]` | array | ordered actions; each has an `action` name (free text, matched loosely against the fake agent's known action vocabulary — see fake agent spec), `params`, and an optional `expect` block |
| `expect.status` | `success` \| `error` | |
| `expect.error_code` | string | only relevant when `status: error` |
| `repeat` | number | how many simulated sessions run this exact script |

## 3. Combined Mode

A single file may include both declarative personas (for breadth) and a
`scripted` block (for one or more precise journeys), under a shared `name`:

```yaml
name: checkout-flow-full
mode: combined

personas:
  - type: new_customer
    weight: 0.6
  - type: returning_customer
    weight: 0.4

sessions: 10000

scripted:
  - name: gdpr-delete-mid-checkout
    steps:
      - action: add_to_cart
        params: { product_id: "sku_2044" }
      - action: request_account_deletion
      - action: submit_checkout
        expect:
          status: error
          error_code: "ACCOUNT_DELETED"
    repeat: 200
```

## 4. v0 Implementation Notes

- v0 does **not** execute real code against these sims. `core/fakeAgent.ts`
  and the runner read the sim's `sessions`/`repeat` counts and persona/step
  *labels* to generate believable, consistent pass/fail numbers and log lines
  — the assertions and `expect` blocks are used as **display text**, not
  evaluated against anything real.
- Validation in v0 should be light-touch: confirm `name` and `mode` exist,
  and that the mode-appropriate required fields (`personas`+`sessions` for
  declarative, `steps`+`repeat` for scripted) are present. Reject with a
  clear error otherwise.
- `forge sim add --user-type <type> --count <n>` (the inline quick-add path)
  should generate a minimal declarative-mode file under the hood with a
  single persona entry, so both CLI input paths converge on the same on-disk
  format.
