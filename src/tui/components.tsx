// Presentational building blocks for the Forge TUI.

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { FORGE_LOGO, LOGO_GRADIENT, palette } from "./brand.js";

export const theme = palette;

/** The gradient FORGE wordmark, optionally centered. */
export function Logo({ align = "flex-start" }: { align?: "flex-start" | "center" }): React.JSX.Element {
  return (
    <Box flexDirection="column" alignItems={align}>
      {FORGE_LOGO.map((line, i) => (
        <Text key={i} color={LOGO_GRADIENT[i] ?? palette.brand} bold>
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** A titled, bordered panel. */
export function Panel(props: {
  title: string;
  titleColor?: string;
  children: ReactNode;
  width?: number;
  flexGrow?: number;
  minHeight?: number;
  borderColor?: string;
}): React.JSX.Element {
  return (
    <Box
      borderStyle="single"
      borderColor={props.borderColor ?? theme.border}
      flexDirection="column"
      paddingX={1}
      width={props.width}
      flexGrow={props.flexGrow}
      minHeight={props.minHeight}
    >
      <Text color={props.titleColor ?? theme.title}>
        {props.title.toUpperCase()}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {props.children}
      </Box>
    </Box>
  );
}

/** A small section heading with an accent tick, for inside panels/screens. */
export function SectionTitle({ children, color }: { children: string; color?: string }): React.JSX.Element {
  return (
    <Text color={color ?? theme.accent} bold>
      ▌ {children}
    </Text>
  );
}

export function StatRow(props: {
  label: string;
  value: string;
  color?: string;
  marginTop?: number;
}): React.JSX.Element {
  return (
    <Box justifyContent="space-between" marginTop={props.marginTop}>
      <Text color={theme.dim}>{props.label}</Text>
      <Text color={props.color ?? theme.info}>{props.value}</Text>
    </Box>
  );
}

/** A filled/empty bar for progress and rates. */
export function Bar(props: { value: number; width?: number; color?: string }): React.JSX.Element {
  const width = props.width ?? 12;
  const filled = Math.max(0, Math.min(width, Math.round((props.value / 100) * width)));
  return (
    <Text>
      <Text color={props.color}>{"▓".repeat(filled)}</Text>
      <Text color={theme.border}>{"░".repeat(width - filled)}</Text>
    </Text>
  );
}

/** A colored, bracketed status chip, e.g. [ sandbox ]. */
export function Chip({ label, color }: { label: string; color?: string }): React.JSX.Element {
  return (
    <Text color={color ?? theme.info} bold>
      [ {label} ]
    </Text>
  );
}

/** A single keybinding hint, e.g. ⏎ start. */
export function KeyHint({ keyLabel, action }: { keyLabel: string; action: string }): React.JSX.Element {
  return (
    <Text>
      <Text color={theme.key} bold>
        {keyLabel}
      </Text>
      <Text dimColor> {action}</Text>
    </Text>
  );
}

/** A horizontal row of key hints separated by dim dots. */
export function KeyBar({ hints }: { hints: Array<{ keyLabel: string; action: string }> }): React.JSX.Element {
  return (
    <Box>
      {hints.map((h, i) => (
        <Box key={h.keyLabel}>
          {i > 0 ? <Text dimColor>{"  ·  "}</Text> : null}
          <KeyHint keyLabel={h.keyLabel} action={h.action} />
        </Box>
      ))}
    </Box>
  );
}
