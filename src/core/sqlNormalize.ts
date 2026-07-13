// Pure SQL normalization for policy DETECTION. The policy rules must not be
// evadable by SQL comments, string-literal contents, or multi-statement batches,
// so keyword matching runs on a normalized form: comments removed, string
// literal contents blanked, and the text split into top-level statements.
// Rewrites/forwarding still use the ORIGINAL SQL — normalization is match-only.
// See docs/06-POLICY-ENGINE-SPEC.md.

/** Remove block (slash-star), `--`, and `#` line comments. */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments (non-greedy, multiline)
    .replace(/--[^\n]*/g, " ") // -- line comments
    .replace(/#[^\n]*/g, " "); // # line comments (mysql-style)
}

/**
 * Replace the CONTENTS of single- and double-quoted string literals with spaces,
 * so a keyword like WHERE (or a `;`) hidden inside a string is not seen by the
 * matchers. Doubled quotes ('') are treated as an escaped quote inside the
 * string. Quote characters themselves are preserved so token boundaries survive.
 */
export function blankStringLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += quote;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += "  "; // escaped quote inside the literal
            i += 2;
            continue;
          }
          break;
        }
        out += " ";
        i++;
      }
      if (i < sql.length) {
        out += quote;
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Comment-stripped + string-blanked text, for keyword matching only. */
export function normalizeSql(sql: string): string {
  return blankStringLiterals(stripSqlComments(sql));
}

/**
 * Split SQL into individual top-level statements, normalized for detection.
 * Because string contents and comments are blanked/removed first, a `;` inside a
 * string or comment does not split. Empty fragments are dropped and each
 * statement is trimmed.
 */
export function splitSqlStatements(sql: string): string[] {
  return normalizeSql(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
