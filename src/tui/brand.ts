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

// Ember palette. Terminal-friendly (borders lifted a bit so they read on a
// pure-black terminal, unlike the mockup's #242018 on a #0d0c0b card).
export const palette = {
  border: "#3f382c", // warm brown frame
  title: "#8a7c60", // muted section titles
  accent: "#f59e0b", // amber — the single accent
  brand: "#f59e0b",
  pass: "#4ade80", // green
  warn: "#f59e0b", // amber
  block: "#f87171", // red
  info: "#c8c2b8", // warm light (values)
  dim: "#6b6150", // warm dim (labels / hints)
  key: "#f59e0b", // amber (keys)
  text: "#ddd8cf", // primary
  muted: "#7a7060", // secondary
} as const;
