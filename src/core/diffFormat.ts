// Converts FileDiff[] into a unified-diff-style patch text (for saving to
// disk) and provides terminal rendering helpers. See docs/07-FAKE-AGENT-SPEC.md
// "Diff Generation" and docs/05-CLI-UX-SPEC.md "forge diff".

import type { FileDiff } from "../types.js";

export function buildPatchText(diffs: FileDiff[]): string {
  const lines: string[] = [];

  for (const file of diffs) {
    const tag = file.status === "added" ? "new file" : file.status === "deleted" ? "deleted" : "modified";
    lines.push(`--- ${file.path} (${tag})`);
    lines.push(`+++ ${file.path}`);
    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.startLine} +${hunk.startLine} @@`);
      for (const line of hunk.lines) {
        const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
        lines.push(`${prefix}${line.text}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export interface DiffSummary {
  path: string;
  status: FileDiff["status"];
  added: number;
  removed: number;
}

export function summarizeDiffs(diffs: FileDiff[]): DiffSummary[] {
  return diffs.map((file) => {
    let added = 0;
    let removed = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") added += 1;
        if (line.type === "remove") removed += 1;
      }
    }
    return { path: file.path, status: file.status, added, removed };
  });
}
