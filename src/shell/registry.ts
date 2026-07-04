// Command registry for the interactive Forge shell. Each command wraps the
// same core modules the one-shot CLI uses (store, simDb, mockApi, …) but
// RETURNS structured output lines instead of printing — the Ink shell renders
// them into its transcript. `run` is special: the shell intercepts it to mount
// the live dashboard rather than producing transcript lines.

import { v4 as uuidv4 } from "uuid";
import yaml from "js-yaml";
import fs from "node:fs";
import path from "node:path";
import {
  loadForgeYaml,
  saveForgeYaml,
  forgeYamlExists,
  ensureForgeDirs,
  saveSchema,
  loadSchema,
  saveSimFile,
  loadState,
  saveState,
  loadRun,
  listRuns,
  saveRun,
  getProjectRoot,
  setProjectRoot,
} from "../core/store.js";
import {
  detectDbType,
  generateSchema,
  generateSyntheticRows,
  totalIndexes,
} from "../core/simDb.js";
import { getPreset, listPresets } from "../core/mockApi.js";
import { summarizeDiffs } from "../core/diffFormat.js";
import { detectProject } from "../core/detect.js";
import { POLICY_PRESETS, describePreset } from "../core/policyEngine.js";

const POLICY_HELP: Record<string, string> = Object.fromEntries(POLICY_PRESETS.map((p) => [p.name, p.description]));
import type {
  ForgeConfig,
  DbSchema,
  MockConfig,
  PolicyPreset,
  SimFile,
  SimulationRef,
} from "../types.js";

export type Tone = "ok" | "warn" | "err" | "info" | "dim" | "plain" | "head";
export interface OutLine {
  text: string;
  tone?: Tone;
}
export interface CommandResult {
  ok: boolean;
  lines: OutLine[];
}
export interface ArgSpec {
  name: string;
  required?: boolean;
  placeholder?: string;
}
/** A field in a guided arg form. `key` is a positional name, or a "--flag". */
export interface FormField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  choices?: string[];
  /** optional description shown for the highlighted choice. */
  choiceHelp?: Record<string, string>;
  /** one-line explanation of what this field is, shown under the label. */
  help?: string;
  default?: string;
}
export type Handler = (argv: string[]) => CommandResult | Promise<CommandResult>;
export interface SubCommand {
  name: string;
  summary: string;
  args?: ArgSpec[];
  form?: FormField[];
  run: Handler;
}
export interface Command {
  name: string;
  summary: string;
  subcommands?: SubCommand[];
  args?: ArgSpec[];
  form?: FormField[];
  run?: Handler;
  special?: "run" | "box" | "clear" | "quit" | "guide";
}

/** Build a handler argv from collected form values (positionals + flags). */
export function argvFromForm(fields: FormField[], values: string[]): string[] {
  const argv: string[] = [];
  fields.forEach((f, i) => {
    const v = (values[i] ?? "").trim();
    if (!v) return;
    if (f.key.startsWith("--")) argv.push(f.key, v);
    else argv.push(v);
  });
  return argv;
}

// ── small helpers ─────────────────────────────────────────────────
const ok = (...lines: OutLine[]): CommandResult => ({ ok: true, lines });
const err = (msg: string, hint?: string): CommandResult => ({
  ok: false,
  lines: hint ? [{ text: `✗ ${msg}`, tone: "err" }, { text: `  ${hint}`, tone: "dim" }] : [{ text: `✗ ${msg}`, tone: "err" }],
});
const noProject = (): CommandResult => err("no project here", "run `forge init` first");

interface Parsed {
  positionals: string[];
  flags: Record<string, string | boolean>;
}
function parseFlags(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positionals.push(t);
  }
  return { positionals, flags };
}

const VALID_PRESETS: PolicyPreset[] = ["default", "strict", "soc2", "hipaa", "custom"];
function normalizePreset(v: string): PolicyPreset {
  const x = v.trim().toLowerCase();
  return (VALID_PRESETS as string[]).includes(x) ? (x as PolicyPreset) : "default";
}

function defaultConfig(name: string, preset: PolicyPreset): ForgeConfig {
  const onBlock = preset === "soc2" || preset === "hipaa" ? "stop_run" : "notify_agent";
  return {
    project: name,
    version: 1,
    mode: "sandbox",
    data: { databases: [], mocks: [] },
    simulations: [],
    policy: {
      preset,
      rules: [
        { block: "SELECT *" },
        { block: "DROP TABLE" },
        { block: "TRUNCATE" },
        { require: "WHERE on UPDATE/DELETE" },
        { pii_fields: ["email", "phone", "address", "ssn"] },
        { require: "auth on /api/**" },
      ],
      on_intercept: "rewrite",
      on_block: onBlock,
    },
    agents: [],
    approve: { require_pass_rate: 95, require_zero_blocks: false, human_approval: true },
    integrations: {},
    sessions: { mode: "isolated", conflict_detection: true, merge_on_approve: true },
  };
}

// ── command definitions ───────────────────────────────────────────
export const COMMANDS: Command[] = [
  {
    name: "init",
    summary: "scaffold a Forge project here",
    args: [{ name: "name", placeholder: "project-name" }],
    form: [
      { key: "name", label: "project name", placeholder: "acme-checkout", required: true },
      { key: "--policy", label: "policy preset", choices: ["default", "strict", "soc2", "hipaa"], choiceHelp: POLICY_HELP, default: "default" },
    ],
    run: (argv) => {
      const { positionals, flags } = parseFlags(argv);
      const name = positionals[0] ?? (typeof flags.name === "string" ? flags.name : "my-project");
      const preset = normalizePreset(typeof flags.policy === "string" ? flags.policy : "default");

      // If a project already exists here, scaffold the new one in ./<name>/ and
      // switch the shell into it (so `forge init x` from within a project makes
      // a fresh project, not an "already exists" error).
      let inSubdir = false;
      if (forgeYamlExists() && !flags.force) {
        const sub = path.join(getProjectRoot(), name);
        if (fs.existsSync(path.join(sub, "forge.yaml"))) {
          return err(`project "${name}" already exists here`, "pick another name, or `forge switch " + name + "`");
        }
        fs.mkdirSync(sub, { recursive: true });
        setProjectRoot(sub);
        inSubdir = true;
      }

      const config = defaultConfig(name, preset);
      const detected = detectProject(getProjectRoot());
      if (detected.target) config.target = detected.target;
      ensureForgeDirs();
      saveForgeYaml(config);
      const lines: OutLine[] = [{ text: `✓ project "${name}" created${inSubdir ? ` in ./${name}/` : ""} · policy ${preset}`, tone: "ok" }];
      if (inSubdir) lines.push({ text: `  switched here — \`forge switch ..\` to go back`, tone: "dim" });
      if (detected.target) lines.push({ text: `✓ ${detected.note}`, tone: "ok" });
      lines.push({ text: "next: forge db link  ·  forge mock add  ·  forge attach", tone: "dim" });
      return { ok: true, lines };
    },
  },
  {
    name: "db",
    summary: "link a database · view schema",
    subcommands: [
      {
        name: "link",
        summary: "register a connector + generate synthetic rows",
        args: [{ name: "connectionString", required: true, placeholder: "postgres://host:5432/db" }],
        form: [
          { key: "connectionString", label: "connection string", help: "your database URL — Forge reads only the schema shape, never real rows", placeholder: "postgres://localhost:5432/acme_prod", required: true },
          { key: "--rows", label: "synthetic rows", help: "how many fake rows to seed the sandbox with", default: "50000" },
        ],
        run: (argv) => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          const { positionals, flags } = parseFlags(argv);
          const conn = positionals[0];
          if (!conn) return err("missing connection string", "e.g. forge db link postgres://localhost:5432/db");
          ensureForgeDirs();
          const schema = generateSchema(conn);
          saveSchema(schema);
          const totalRows = flags.rows ? Number(flags.rows) : 50000;
          const rc = generateSyntheticRows(schema, totalRows);
          c.data.databases = c.data.databases.filter((d) => d.name !== "primary");
          c.data.databases.push({
            name: "primary",
            type: detectDbType(conn),
            schema_from: conn,
            sim_rows: rc.totalRows,
            distributions: "auto",
            linked_at: new Date().toISOString(),
          });
          saveForgeYaml(c);
          return ok(
            { text: `✓ ${schema.tables.length} tables, ${totalIndexes(schema)} indexes detected`, tone: "ok" },
            { text: `✓ ${rc.totalRows.toLocaleString()} synthetic rows → forge-sim://${c.project}`, tone: "ok" },
            { text: "⚠ no prod data copied — schema shape only", tone: "warn" }
          );
        },
      },
      {
        name: "status",
        summary: "show the linked database + schema",
        run: () => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          if (c.data.databases.length === 0) return ok({ text: "no database linked — forge db link <conn>", tone: "dim" });
          const lines: OutLine[] = [];
          for (const db of c.data.databases) {
            lines.push({ text: `✓ ${db.name} (${db.type}) · ${db.sim_rows.toLocaleString()} sim rows`, tone: "ok" });
            lines.push({ text: `  schema_from: ${db.schema_from}`, tone: "dim" });
          }
          const schema = loadSchema<DbSchema>();
          if (schema) {
            lines.push({ text: `  schema: ${schema.tables.length} tables, ${totalIndexes(schema)} indexes`, tone: "dim" });
            for (const t of schema.tables) {
              const pii = t.columns.filter((col) => col.pii).map((col) => col.name);
              lines.push({ text: `    ${t.name} — ${t.columns.length} cols${pii.length ? ` (pii: ${pii.join(", ")})` : ""}`, tone: "dim" });
            }
          }
          return { ok: true, lines };
        },
      },
    ],
  },
  {
    name: "mock",
    summary: "add / list mock APIs",
    subcommands: [
      {
        name: "add",
        summary: "register a mock third-party API",
        args: [{ name: "service", required: true, placeholder: "stripe" }],
        form: [{ key: "service", label: "service", choices: ["stripe", "sendgrid", "twilio"], required: true }],
        run: (argv) => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          const service = parseFlags(argv).positionals[0];
          if (!service) return err("missing service", "e.g. forge mock add stripe");
          const preset = getPreset(service);
          if (!preset) return err(`unknown service "${service}"`, `available: ${listPresets().map((p) => p.service).join(", ")}`);
          const mc: MockConfig = {
            name: service,
            preset: preset.preset,
            scenarios: preset.scenarios,
            capture: preset.capture,
            added_at: new Date().toISOString(),
          };
          c.data.mocks = c.data.mocks.filter((m) => m.name !== service);
          c.data.mocks.push(mc);
          saveForgeYaml(c);
          const lines: OutLine[] = [{ text: `✓ ${service} mock registered (preset: ${preset.preset})`, tone: "ok" }];
          if (preset.scenarios) lines.push({ text: `  scenarios: ${preset.scenarios.join(", ")}`, tone: "dim" });
          if (preset.capture) lines.push({ text: "  mode: capture (calls logged, never sent)", tone: "dim" });
          return { ok: true, lines };
        },
      },
      {
        name: "list",
        summary: "list registered mocks",
        run: () => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          if (c.data.mocks.length === 0) return ok({ text: "no mocks yet — forge mock add stripe", tone: "dim" });
          return { ok: true, lines: c.data.mocks.map((m) => ({ text: `✓ ${m.name} (preset: ${m.preset})`, tone: "ok" as Tone })) };
        },
      },
    ],
  },
  {
    name: "sim",
    summary: "add / list simulations",
    subcommands: [
      {
        name: "add",
        summary: "register a sim from a file or inline persona",
        args: [{ name: "--file or --user-type", placeholder: "--user-type expired_card --count 500" }],
        form: [
          { key: "--user-type", label: "persona / user type", help: "a kind of user to simulate — drives synthetic traffic at your app", placeholder: "expired_card_with_coupon", required: true },
          { key: "--count", label: "sessions", help: "how many simulated users of this persona to run", default: "500" },
        ],
        run: (argv) => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          const { flags } = parseFlags(argv);
          if (typeof flags.file === "string") {
            const full = path.resolve(process.cwd(), flags.file);
            if (!fs.existsSync(full)) return err(`file not found: ${flags.file}`);
            let sim: SimFile;
            try {
              sim = yaml.load(fs.readFileSync(full, "utf-8")) as SimFile;
            } catch (e) {
              return err("failed to parse sim YAML", String(e));
            }
            if (!sim.name || !sim.mode) return err("invalid sim file", "missing name or mode");
            const saved = saveSimFile(sim.name, fs.readFileSync(full, "utf-8"));
            const ref: SimulationRef = { name: sim.name, file: saved, sessions: sim.sessions ?? sim.repeat ?? 0, concurrency: sim.concurrency };
            c.simulations = c.simulations.filter((s) => s.name !== sim.name);
            c.simulations.push(ref);
            saveForgeYaml(c);
            return ok({ text: `✓ simulation "${sim.name}" loaded (${sim.mode}) · ${ref.sessions.toLocaleString()} sessions`, tone: "ok" });
          }
          if (typeof flags["user-type"] === "string") {
            const count = Number(flags.count ?? 500);
            const simFile: SimFile = { name: "edge-cases", mode: "declarative", personas: [{ type: flags["user-type"], weight: 1 }], sessions: count };
            const saved = saveSimFile("edge-cases", yaml.dump(simFile, { lineWidth: 100 }));
            c.simulations = c.simulations.filter((s) => s.name !== "edge-cases");
            c.simulations.push({ name: "edge-cases", file: saved, sessions: count });
            saveForgeYaml(c);
            return ok({ text: `✓ simulation "edge-cases" created · persona ${flags["user-type"]} · ${count.toLocaleString()} sessions`, tone: "ok" });
          }
          return err("no input", "use --file <path> or --user-type <type> --count <n>");
        },
      },
      {
        name: "list",
        summary: "list registered simulations",
        run: () => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          if (c.simulations.length === 0) return ok({ text: "no sims yet — forge sim add --file <path>", tone: "dim" });
          return { ok: true, lines: c.simulations.map((s) => ({ text: `✓ ${s.name} — ${s.sessions.toLocaleString()} sessions`, tone: "ok" as Tone })) };
        },
      },
    ],
  },
  {
    name: "attach",
    summary: "attach an AI agent + write scope",
    args: [{ name: "agent", required: true, placeholder: "cursor --scope ./src/**" }],
    form: [
      { key: "agent", label: "agent name", help: "a label for whoever/whatever runs in the box", choices: ["cursor", "claude-code", "copilot", "windsurf"], default: "cursor" },
      { key: "--scope", label: "writable paths (glob)", help: "files the agent may write to — writes anywhere else are blocked. Use ./** for the whole project.", placeholder: "./src/checkout/**", required: true },
      { key: "--exec", label: "command to run in the box", help: "the command Forge runs sandboxed on `forge run` (e.g. your agent/test/script)", placeholder: "node agent-task.mjs" },
    ],
    run: (argv) => {
      const c = loadForgeYaml();
      if (!c) return noProject();
      const { positionals, flags } = parseFlags(argv);
      const agent = positionals[0];
      if (!agent) return err("missing agent name", "e.g. forge attach cursor --scope ./src/checkout/**");
      const scope = typeof flags.scope === "string" ? flags.scope : "";
      if (!scope) return err("--scope is required", 'e.g. --scope "./src/checkout/**"');
      const readOnly = typeof flags["read-only"] === "string" ? [flags["read-only"]] : [];
      const command = typeof flags.exec === "string" ? flags.exec : undefined;
      c.agents = [{ name: agent, scope, read_only: readOnly, env: "sandbox", attached_at: new Date().toISOString(), command }];
      saveForgeYaml(c);
      const st = loadState();
      st.attachedAgent = { sessionId: uuidv4().slice(0, 8), name: agent, scope, readOnly, attachedAt: new Date().toISOString() };
      saveState(st);
      const lines: OutLine[] = [{ text: `✓ ${agent} attached`, tone: "ok" }, { text: `  scope: ${scope}  ·  env: sandbox`, tone: "dim" }];
      if (command) lines.push({ text: `  runs in the box: ${command}  →  forge run`, tone: "dim" });
      return { ok: true, lines };
    },
  },
  {
    name: "target",
    summary: "set the app to run for real (--real) runs",
    subcommands: [
      {
        name: "set",
        summary: "set the app start command + port",
        args: [{ name: "start", required: true, placeholder: 'node src/server.mjs --port 3000' }],
        form: [
          { key: "start", label: "start command", help: "how Forge launches your app for --real runs (use a direct `node …`)", placeholder: "node src/server.mjs", required: true },
          { key: "--port", label: "port", help: "the port your app listens on", default: "3000" },
          { key: "--cwd", label: "app directory (optional)", help: "where to run the app from", placeholder: "examples/acme-checkout" },
        ],
        run: (argv) => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          const { positionals, flags } = parseFlags(argv);
          const start = positionals[0];
          if (!start) return err("missing start command", 'e.g. forge target set "node src/server.mjs" --port 3000');
          c.target = { start, port: Number(flags.port ?? 3000), cwd: typeof flags.cwd === "string" ? flags.cwd : undefined };
          saveForgeYaml(c);
          return ok({ text: `✓ target set · ${start} · port ${c.target.port}`, tone: "ok" }, { text: "real run: forge run --real", tone: "dim" });
        },
      },
      {
        name: "show",
        summary: "show the configured target",
        run: () => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          if (!c.target) return ok({ text: "no target set — forge target set", tone: "dim" });
          return ok(
            { text: `start: ${c.target.start}`, tone: "plain" },
            { text: `port:  ${c.target.port}${c.target.cwd ? `  ·  cwd: ${c.target.cwd}` : ""}`, tone: "dim" }
          );
        },
      },
    ],
  },
  { name: "run", summary: "run the sandbox — add --real for the live engine", special: "run", args: [{ name: "--task / --real", placeholder: '--task "add coupon validation" [--real]' }] },
  { name: "box", summary: "run ANY command inside the sandbox box (isolated + intercepted)", special: "box", args: [{ name: "command", required: true, placeholder: "node script.mjs" }] },
  {
    name: "diff",
    summary: "show a run's code diff",
    args: [{ name: "runId", required: true, placeholder: "run-1" }],
    run: (argv) => {
      const runId = parseFlags(argv).positionals[0];
      if (!runId) return err("missing run id", `available: ${listRuns().join(", ") || "(none)"}`);
      const rec = loadRun(runId);
      if (!rec) return err(`run ${runId} not found`, `available: ${listRuns().join(", ") || "(none)"}`);
      const lines: OutLine[] = [];
      const summaries = summarizeDiffs(rec.diffs);
      rec.diffs.forEach((file, i) => {
        const s = summaries[i];
        lines.push({ text: `${file.path}  +${s.added} -${s.removed}${file.status === "added" ? "  (new)" : ""}`, tone: "head" });
        for (const hunk of file.hunks) {
          for (const ln of hunk.lines) {
            const tone: Tone = ln.type === "add" ? "ok" : ln.type === "remove" ? "err" : "dim";
            const mark = ln.type === "add" ? "+" : ln.type === "remove" ? "-" : " ";
            lines.push({ text: `${mark} ${ln.text}`, tone });
          }
        }
      });
      return { ok: true, lines };
    },
  },
  {
    name: "report",
    summary: "render a run's report",
    args: [{ name: "runId", required: true, placeholder: "run-1" }],
    run: (argv) => {
      const runId = parseFlags(argv).positionals[0];
      const rec = runId ? loadRun(runId) : null;
      if (!rec) return err(`run ${runId ?? ""} not found`, `available: ${listRuns().join(", ") || "(none)"}`);
      const r = rec.report;
      const lines: OutLine[] = [
        { text: `Run Report — ${r.runId}`, tone: "head" },
        { text: `  files changed: ${r.filesChanged}  ·  intercepts: ${r.policyStats.intercepts}  ·  blocks: ${r.policyStats.blocks}`, tone: "plain" },
      ];
      for (const sim of r.simResults) {
        const rate = ((sim.passedSessions / sim.totalSessions) * 100).toFixed(1);
        const clean = sim.failedSessions === 0 || !sim.failingPersona;
        lines.push({ text: `  ${clean ? "✓" : "⚠"} ${sim.name} — ${rate}% (${sim.passedSessions.toLocaleString()}/${sim.totalSessions.toLocaleString()})`, tone: clean ? "ok" : "warn" });
        if (!clean) lines.push({ text: `      ↳ ${sim.failingPersona}: ${sim.failureReason}`, tone: "dim" });
        for (const a of sim.assertions ?? []) lines.push({ text: `      · ${a}`, tone: "dim" });
      }
      const meets = r.passRate >= 95;
      lines.push({ text: `  pass rate ${r.passRate}%  ${r.approved ? "· approved" : meets ? "· eligible" : "· below threshold"}`, tone: meets ? "ok" : "warn" });
      return { ok: true, lines };
    },
  },
  {
    name: "approve",
    summary: "approve a run (gated by pass rate)",
    args: [{ name: "runId", required: true, placeholder: "run-1 [--force]" }],
    run: (argv) => {
      const c = loadForgeYaml();
      if (!c) return noProject();
      const { positionals, flags } = parseFlags(argv);
      const runId = positionals[0];
      const rec = runId ? loadRun(runId) : null;
      if (!rec) return err(`run ${runId ?? ""} not found`, `available: ${listRuns().join(", ") || "(none)"}`);
      const threshold = c.approve.require_pass_rate;
      const { passRate } = rec.report;
      if (passRate < threshold && !flags.force) {
        return err(`cannot approve: ${passRate}% is below required ${threshold}%`, "re-run with --force to override");
      }
      rec.report.approved = true;
      rec.report.approvedAt = new Date().toISOString();
      rec.report.approvedForced = passRate < threshold;
      saveRun(rec);
      return ok({ text: `✓ ${runId} approved${passRate < threshold ? " (forced)" : ""} @ ${rec.report.approvedAt}`, tone: "ok" });
    },
  },
  {
    name: "connect",
    summary: "connect a CI/CD provider (github)",
    args: [{ name: "provider", required: true, placeholder: "github" }],
    form: [{ key: "provider", label: "provider", choices: ["github"], default: "github" }],
    run: (argv) => {
      const c = loadForgeYaml();
      if (!c) return noProject();
      const provider = parseFlags(argv).positionals[0];
      if (provider !== "github") return err(`unknown provider: ${provider ?? ""}`, "supported: github");
      c.mode = "ci";
      c.integrations.github = { repo: `${c.project}-org/${c.project}`, on: "pr_open", post_check: true, connected_at: new Date().toISOString() };
      saveForgeYaml(c);
      return ok({ text: "✓ (simulated) github connected · mode → ci", tone: "ok" }, { text: "  run reports would post as PR checks", tone: "dim" });
    },
  },
  {
    name: "disconnect",
    summary: "disconnect a provider",
    args: [{ name: "provider", required: true, placeholder: "github" }],
    run: (argv) => {
      const c = loadForgeYaml();
      if (!c) return noProject();
      const provider = parseFlags(argv).positionals[0];
      if (provider !== "github") return err(`unknown provider: ${provider ?? ""}`, "supported: github");
      delete c.integrations.github;
      if (Object.keys(c.integrations).length === 0) c.mode = "sandbox";
      saveForgeYaml(c);
      return ok({ text: `✓ github disconnected · mode → ${c.mode}`, tone: "ok" });
    },
  },
  {
    name: "switch",
    summary: "switch to another project directory (cd-like)",
    args: [{ name: "path", required: true, placeholder: ".. | demo_123" }],
    run: (argv) => {
      const target = parseFlags(argv).positionals[0];
      if (!target) return err("missing path", "e.g. forge switch demo_123  ·  forge switch ..");
      const dir = path.resolve(getProjectRoot(), target);
      if (!fs.existsSync(dir)) return err(`no such directory: ${target}`);
      setProjectRoot(dir);
      const c = loadForgeYaml();
      if (!c) return { ok: true, lines: [{ text: `switched to ${dir}`, tone: "warn" }, { text: "  no project here — forge init to create one", tone: "dim" }] };
      return ok({ text: `✓ switched to "${c.project}"`, tone: "ok" }, { text: `  ${dir}`, tone: "dim" });
    },
  },
  {
    name: "project",
    summary: "show the current project + directory",
    run: () => {
      const c = loadForgeYaml();
      if (!c) return ok({ text: `no project · ${getProjectRoot()}`, tone: "dim" });
      return ok({ text: `${c.project} · ${c.mode}`, tone: "info" }, { text: `  ${getProjectRoot()}`, tone: "dim" });
    },
  },
  {
    name: "status",
    summary: "show this project's setup",
    run: () => {
      const c = loadForgeYaml();
      if (!c) return noProject();
      const agent = c.agents[0];
      const runs = listRuns();
      return ok(
        { text: `project ${c.project} · mode ${c.mode} · policy ${c.policy.preset}`, tone: "plain" },
        { text: `  db: ${c.data.databases[0]?.type ?? "none"}  ·  mocks: ${c.data.mocks.map((m) => m.name).join(", ") || "none"}`, tone: "dim" },
        { text: `  sims: ${c.simulations.length}  ·  agent: ${agent ? `${agent.name} → ${agent.scope}` : "none attached"}`, tone: "dim" },
        { text: `  runs: ${runs.length ? runs.join(", ") : "none"}`, tone: "dim" }
      );
    },
  },
  {
    name: "policy",
    summary: "view or change the policy preset",
    subcommands: [
      {
        name: "show",
        summary: "show the current policy",
        run: () => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          return ok(
            { text: `preset: ${c.policy.preset}`, tone: "info" },
            { text: `  ${describePreset(c.policy.preset)}`, tone: "dim" },
            { text: `  on_intercept: ${c.policy.on_intercept}  ·  on_block: ${c.policy.on_block}`, tone: "dim" }
          );
        },
      },
      {
        name: "list",
        summary: "list all presets and what they do",
        run: () => {
          const lines: OutLine[] = [{ text: "Policy presets", tone: "head" }];
          for (const p of POLICY_PRESETS) {
            lines.push({ text: `  ${p.name}`, tone: "ok" });
            lines.push({ text: `    ${p.description}`, tone: "dim" });
          }
          return { ok: true, lines };
        },
      },
      {
        name: "set",
        summary: "change the policy preset",
        args: [{ name: "preset", required: true, placeholder: "default | strict | soc2 | hipaa" }],
        form: [{ key: "preset", label: "policy preset", choices: ["default", "strict", "soc2", "hipaa", "custom"], choiceHelp: POLICY_HELP, default: "default" }],
        run: (argv) => {
          const c = loadForgeYaml();
          if (!c) return noProject();
          const raw = parseFlags(argv).positionals[0];
          if (!raw) return err("missing preset", "e.g. forge policy set strict");
          if (!(VALID_PRESETS as string[]).includes(raw.toLowerCase())) {
            return err(`unknown preset: ${raw}`, `valid: ${VALID_PRESETS.join(", ")}`);
          }
          const preset = raw.toLowerCase() as PolicyPreset;
          c.policy.preset = preset;
          c.policy.on_block = preset === "soc2" || preset === "hipaa" ? "stop_run" : "notify_agent";
          saveForgeYaml(c);
          return ok({ text: `✓ policy → ${preset}`, tone: "ok" }, { text: `  ${describePreset(preset)}`, tone: "dim" });
        },
      },
    ],
  },
  { name: "guide", summary: "open the Forge user guide", special: "guide" },
  { name: "help", summary: "list all commands", run: () => helpResult() },
  { name: "clear", summary: "clear the transcript", special: "clear" },
  { name: "quit", summary: "exit Forge", special: "quit" },
  { name: "exit", summary: "exit Forge", special: "quit" },
];

function helpResult(): CommandResult {
  const lines: OutLine[] = [{ text: "Forge commands — type `forge <command>`", tone: "head" }];
  for (const cmd of COMMANDS) {
    lines.push({ text: `  forge ${cmd.name.padEnd(11)} ${cmd.summary}`, tone: "plain" });
    for (const sub of cmd.subcommands ?? []) {
      lines.push({ text: `    ${cmd.name} ${sub.name.padEnd(9)} ${sub.summary}`, tone: "dim" });
    }
  }
  return { ok: true, lines };
}

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}
