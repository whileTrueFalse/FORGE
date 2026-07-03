// FORGE branding — the "Ember" theme: warm dark backdrop, a single amber
// accent, and a muted brown text hierarchy. Shared by the shell, the standalone
// TUI, and the guide.

// "ANSI Shadow" block wordmark, rendered with a warm amber gradient (one color
// per row). Used on the standalone TUI welcome; the shell uses a compact mark.
export const FORGE_LOGO: string[] = [
  "███████╗ ██████╗ ██████╗  ██████╗ ███████╗",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝",
  "█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  ",
  "██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  ",
  "██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗",
  "╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝",
];

export const LOGO_GRADIENT: string[] = [
  "#fde68a",
  "#fcd34d",
  "#fbbf24",
  "#f59e0b",
  "#d97706",
  "#b45309",
];

export const MARK = "◆";

export const TAGLINE = "The execution boundary between your AI agent and production.";
export const SUBTAGLINE = "Intercept · Rewrite · Simulate · Approve — before code ever touches a real system.";

// Ember palette — the exact mockup tones (borders nudged one step up from the
// mockup's #242018 so they still read on a pure-black terminal bg).
export const palette = {
  border: "#2f2a20", // dividers (mockup #242018)
  borderFaint: "#1a1610", // status-bar top rule
  title: "#8a7c60", // dashboard panel titles
  label: "#4a4030", // dim uppercase section labels (SETUP / WORKSPACE)
  sep: "#2a2018", // · and │ separators
  accent: "#f59e0b", // amber — the single accent
  brand: "#f59e0b",
  pass: "#4ade80", // green ✓
  warn: "#f59e0b", // amber
  block: "#f87171", // red
  info: "#9a9080", // workspace / result values
  dim: "#4a4030", // labels / hint text
  faint: "#3a3028", // status-bar labels
  navKey: "#5a5040", // ⏎ ↑↓ nav glyphs
  key: "#f59e0b", // amber keys
  text: "#ddd8cf", // primary
  textSoft: "#c8c2b8", // secondary
  muted: "#7a7060", // tagline / not-done labels
  sel: "#1f1a12", // selected-row background
} as const;
