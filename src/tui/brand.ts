// FORGE branding: the TUI wordmark, palette, and taglines. Kept in one place
// so the welcome screen, tour, and dashboard share a consistent identity.

// "ANSI Shadow" block wordmark. Rendered with a vertical magenta→cyan gradient
// (one color per row) for a premium, branded feel.
export const FORGE_LOGO: string[] = [
  "███████╗ ██████╗ ██████╗  ██████╗ ███████╗",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝",
  "█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  ",
  "██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  ",
  "██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗",
  "╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝",
];

export const LOGO_GRADIENT: string[] = [
  "#ff6fd8",
  "#e16ee8",
  "#b873f2",
  "#8a86ff",
  "#5ba6ff",
  "#46c8ff",
];

// A compact anvil glyph used as a small mark next to "FORGE" in tight spots.
export const MARK = "◆";

export const TAGLINE = "The execution boundary between your AI agent and production.";
export const SUBTAGLINE = "Intercept · Rewrite · Simulate · Approve — before code ever touches a real system.";

export const palette = {
  border: "gray",
  title: "cyan",
  accent: "magenta",
  brand: "#b873f2",
  pass: "green",
  warn: "yellow",
  block: "red",
  info: "blue",
  dim: "gray",
  key: "#46c8ff",
} as const;
