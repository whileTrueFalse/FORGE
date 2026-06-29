# forge.yaml — Configuration Schema Spec

`forge.yaml` lives at the project root and is the single source of truth for
a project's sandbox configuration. It is human-readable, meant to be
committed to version control, and is read/written by `core/store.ts`.

## Full Annotated Example

```yaml
project: acme-checkout
version: 1

# Current operating posture. Starts at "sandbox" and only changes via
# `forge connect <provider>` / `forge disconnect <provider>`.
mode: sandbox          # sandbox | ci | cd

data:
  databases:
    - name: primary
      type: postgres                # postgres | mysql | mongodb | sqlite
      schema_from: "$DATABASE_URL"  # the connection string passed to `forge db link`
                                     # (never the literal secret value once
                                     # real impl exists — env var reference only)
      sim_rows: 50000
      distributions: auto           # auto | manual (manual reserved for future)
      linked_at: "2026-06-20T10:04:11Z"

  mocks:
    - name: stripe
      preset: ecommerce
      scenarios: [success, declined, expired]
      added_at: "2026-06-20T10:05:02Z"
    - name: sendgrid
      preset: email
      capture: true
      added_at: "2026-06-20T10:05:18Z"

simulations:
  - name: checkout-flow
    file: .forge/sims/checkout-flow.yaml
    sessions: 12000
    concurrency: 50
  - name: edge-cases
    file: .forge/sims/edge-cases.yaml
    sessions: 500

policy:
  preset: default        # default | strict | soc2 | hipaa | custom
  rules:
    - block: "SELECT *"
    - block: "DROP TABLE"
    - block: "TRUNCATE"
    - require: "WHERE on UPDATE/DELETE"
    - pii_fields: [email, phone, address, ssn]
    - require: "auth on /api/**"
  on_intercept: rewrite    # rewrite | warn | block
  on_block: notify_agent   # notify_agent | stop_run

agents:
  - name: cursor
    scope: "./src/checkout/**"
    read_only: ["./src/auth/**", "./src/users/**"]
    env: sandbox
    attached_at: "2026-06-20T10:06:40Z"

approve:
  require_pass_rate: 95       # integer 0-100; refuse `forge approve` below this
  require_zero_blocks: false  # if true, any unresolved hard block blocks approval
  notify: "slack://engineering-alerts"   # stored but not actually called in v0
  human_approval: true

integrations: {}   # populated by `forge connect <provider>`; empty by default

sessions:
  mode: isolated            # shared | isolated | isolated-sync (multi-agent, future)
  conflict_detection: true
  merge_on_approve: true
```

## Field Reference

### Top level

| Field | Type | Required | Notes |
|---|---|---|---|
| `project` | string | yes | Set at `forge init`, used in CLI headers |
| `version` | number | yes | Schema version, `1` for v0 |
| `mode` | enum | yes | `sandbox` \| `ci` \| `cd`. Default `sandbox`. Changed only via `forge connect`/`disconnect` |

### `data.databases[]`

| Field | Type | Notes |
|---|---|---|
| `name` | string | logical name, referenced nowhere else in v0 but kept for future multi-db support |
| `type` | enum | inferred from the connection string prefix passed to `forge db link` |
| `schema_from` | string | the raw value passed to `forge db link` (in v0, store as-is; treat as opaque) |
| `sim_rows` | number | total synthetic rows generated, default `50000` |
| `distributions` | enum | always `auto` in v0 |
| `linked_at` | ISO datetime | set when `forge db link` runs |

### `data.mocks[]`

| Field | Type | Notes |
|---|---|---|
| `name` | string | the service identifier, e.g. `stripe` |
| `preset` | string | which built-in preset was used |
| `scenarios` | string[] | optional, preset-specific scenario list |
| `capture` | boolean | optional, preset-specific (e.g. sendgrid) |
| `added_at` | ISO datetime | |

### `simulations[]`

| Field | Type | Notes |
|---|---|---|
| `name` | string | unique within the project |
| `file` | string | relative path to the sim YAML under `.forge/sims/` |
| `sessions` | number | total simulated sessions to run |
| `concurrency` | number | optional, cosmetic only in v0 (no real concurrency) |

### `policy`

| Field | Type | Notes |
|---|---|---|
| `preset` | enum | `default` \| `strict` \| `soc2` \| `hipaa` \| `custom`. See `06-POLICY-ENGINE-SPEC.md` for what each preset actually enables |
| `rules` | array | list of rule objects, shape varies by rule type (see policy engine spec) |
| `on_intercept` | enum | `rewrite` \| `warn` \| `block` — global default behavior when a rule matches but isn't independently marked hard-block |
| `on_block` | enum | `notify_agent` \| `stop_run` — what happens after a true hard block |

### `agents[]`

| Field | Type | Notes |
|---|---|---|
| `name` | string | agent identifier, e.g. `cursor`, `claude-code` (free text in v0, no validation against a fixed list) |
| `scope` | string | glob the agent is allowed to write within |
| `read_only` | string[] | globs the agent may read but not write |
| `env` | string | always `sandbox` in v0 |
| `attached_at` | ISO datetime | |

Only one entry should exist at a time in v0 (`forge attach` overwrites the
list rather than appending), since multi-agent support is out of scope — but
keep it as an array so the future extension is additive, not breaking.

### `approve`

| Field | Type | Notes |
|---|---|---|
| `require_pass_rate` | number | 0-100 |
| `require_zero_blocks` | boolean | |
| `notify` | string | stored only, never actually dispatched in v0 |
| `human_approval` | boolean | always `true` in v0 (no auto-approval path exists yet) |

### `integrations`

Empty object by default. `forge connect github` should add something like:

```yaml
integrations:
  github:
    repo: "acme-org/checkout"
    on: pr_open
    post_check: true
    connected_at: "2026-06-20T11:00:00Z"
```

`forge disconnect github` should remove the `github` key entirely (not just
null it out), and if `integrations` becomes empty, `mode` should revert to
`sandbox` (unless another integration is still present, in which case `mode`
stays `ci` or `cd` as appropriate).

### `sessions`

Reserved for multi-agent negotiation (out of scope for v0 behavior, but the
field should exist with sensible defaults so `forge.yaml` files written by
v0 are forward-compatible):

```yaml
sessions:
  mode: isolated
  conflict_detection: true
  merge_on_approve: true
```

## Validation Rules for v0

- `forge init` must refuse to run if `forge.yaml` already exists, unless
  `--force` is passed.
- Every command that mutates `forge.yaml` should read-modify-write the whole
  file (via `js-yaml`) rather than string-patching, to keep formatting
  consistent and avoid corruption.
- Unknown top-level keys should be preserved on write (don't silently drop
  fields the current command doesn't know about) — this matters once the
  schema grows across future phases.
