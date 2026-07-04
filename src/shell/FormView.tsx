// Guided arg form for a command. Prompts field-by-field (text or choice) so a
// user never has to type a whole connection string or remember flag names.
// On the last field it calls onComplete(values); Esc cancels.

import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Panel, theme } from "../tui/components.js";
import type { FormField } from "./registry.js";

export function FormView({
  title,
  fields,
  onComplete,
  onCancel,
}: {
  title: string;
  fields: FormField[];
  onComplete: (values: string[]) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [idx, setIdx] = useState(0);
  const [values, setValues] = useState<string[]>(fields.map((f) => f.default ?? ""));
  const [text, setText] = useState<string>(fields[0]?.default ?? "");
  const [choiceSel, setChoiceSel] = useState(0);

  const field = fields[idx];

  const commit = (value: string) => {
    if (field.required && !value.trim()) return; // stay on a required-but-empty field
    const next = [...values];
    next[idx] = value;
    setValues(next);
    if (idx >= fields.length - 1) {
      onComplete(next);
    } else {
      const ni = idx + 1;
      setIdx(ni);
      setText(next[ni] ?? fields[ni].default ?? "");
      setChoiceSel(0);
    }
  };

  useInput((chars, key) => {
    if (key.escape) return onCancel();
    if (field.choices) {
      if (key.upArrow) setChoiceSel((n) => Math.max(0, n - 1));
      else if (key.downArrow) setChoiceSel((n) => Math.min(field.choices!.length - 1, n + 1));
      else if (key.return) commit(field.choices[choiceSel]);
      return;
    }
    if (key.return) return commit(text);
    if (key.backspace || key.delete) return setText((t) => t.slice(0, -1));
    if (chars && !key.ctrl && !key.meta) setText((t) => t + chars);
  });

  return (
    <Box flexDirection="column">
      <Panel title={title}>
        <Text dimColor>
          step {idx + 1} / {fields.length}
        </Text>
        <Box marginTop={1}>
          <Text bold>{field.label}</Text>
          {field.required ? <Text color={theme.warn}> *</Text> : <Text color={theme.dim}> (optional)</Text>}
        </Box>
        {field.help ? <Text color={theme.dim}>{field.help}</Text> : null}
        {field.choices ? (
          <Box flexDirection="column" marginTop={1}>
            {field.choices.map((c, i) => (
              <Text key={c} color={i === choiceSel ? theme.key : undefined} bold={i === choiceSel}>
                {i === choiceSel ? "▸ " : "  "}
                {c}
              </Text>
            ))}
            {field.choiceHelp?.[field.choices[choiceSel]] ? (
              <Box marginTop={1}>
                <Text dimColor>{field.choiceHelp[field.choices[choiceSel]]}</Text>
              </Box>
            ) : null}
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={theme.accent}>{"› "}</Text>
            {text ? <Text>{text}</Text> : <Text dimColor>{field.placeholder ?? ""}</Text>}
            <Text color={theme.key}>▏</Text>
          </Box>
        )}
      </Panel>
      <Text dimColor>
        {"  "}
        {field.choices ? "↑↓ choose · ⏎ next" : "type · ⏎ next"} · Esc cancel
      </Text>
    </Box>
  );
}
