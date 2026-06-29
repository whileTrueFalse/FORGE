// Suggestion engine for the Forge shell command bar. Given the current input,
// returns what to suggest (the `forge` prefix, top-level commands, subcommands,
// or an inline arg hint) and how to complete the highlighted item. Mirrors the
// Claude-Code "type to filter" feel, but triggered by the word `forge`.

import { COMMANDS, findCommand, type ArgSpec } from "./registry.js";

export interface Suggestion {
  token: string;
  summary: string;
}
export type SuggestContext = "prefix" | "top" | "sub" | "args" | "none";
export interface SuggestState {
  context: SuggestContext;
  items: Suggestion[];
  argHint?: string;
}

function lex(input: string): { tokens: string[]; trailingSpace: boolean } {
  const trailingSpace = /\s$/.test(input);
  const trimmed = input.trim();
  return { tokens: trimmed.length ? trimmed.split(/\s+/) : [], trailingSpace };
}

function argHintText(prefix: string, args: ArgSpec[]): string {
  const parts = args.map((a) => a.placeholder ?? (a.required ? `<${a.name}>` : `[${a.name}]`));
  return `${prefix} ${parts.join(" ")}`;
}

export function computeSuggestions(input: string): SuggestState {
  const { tokens, trailingSpace } = lex(input);
  const none: SuggestState = { context: "none", items: [] };
  if (tokens.length === 0) return none;

  const first = tokens[0].toLowerCase();
  if (first !== "forge") {
    if ("forge".startsWith(first) && first !== "forge") {
      return { context: "prefix", items: [{ token: "forge", summary: "Forge command prefix" }] };
    }
    return none;
  }

  const topItems = (partial: string): SuggestState => ({
    context: "top",
    items: COMMANDS.filter((c) => c.name.startsWith(partial)).map((c) => ({ token: c.name, summary: c.summary })),
  });

  // Still completing the command token.
  if (tokens.length === 1 && !trailingSpace) return topItems("");
  if ((tokens.length === 1 && trailingSpace) || (tokens.length === 2 && !trailingSpace)) {
    return topItems(tokens[1] ?? "");
  }

  // Command token is fully entered.
  const cmd = findCommand(tokens[1]);
  if (!cmd) return none;

  if (cmd.subcommands && cmd.subcommands.length) {
    if ((tokens.length === 2 && trailingSpace) || (tokens.length === 3 && !trailingSpace)) {
      const partial = tokens[2] ?? "";
      return {
        context: "sub",
        items: cmd.subcommands.filter((s) => s.name.startsWith(partial)).map((s) => ({ token: s.name, summary: s.summary })),
      };
    }
    const sub = cmd.subcommands.find((s) => s.name === tokens[2]);
    if (sub?.args?.length) return { context: "args", items: [], argHint: argHintText(`forge ${cmd.name} ${sub.name}`, sub.args) };
    return none;
  }

  if (cmd.args?.length) return { context: "args", items: [], argHint: argHintText(`forge ${cmd.name}`, cmd.args) };
  return none;
}

/** Replace the last (partial) token with the chosen suggestion + a trailing space. */
export function applyCompletion(input: string, token: string): string {
  const { tokens, trailingSpace } = lex(input);
  const base = trailingSpace ? tokens : tokens.slice(0, -1);
  return [...base, token].join(" ") + " ";
}
