// Tracks the terminal dimensions and updates on resize, so the full-screen
// shell layout can size itself to fill the window.

import { useStdout } from "ink";
import { useEffect, useState } from "react";

export interface TermSize {
  columns: number;
  rows: number;
}

export function useTerminalSize(): TermSize {
  const { stdout } = useStdout();
  const read = (): TermSize => ({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [size, setSize] = useState<TermSize>(read);

  useEffect(() => {
    if (typeof stdout.on !== "function") return; // some test stdouts lack events
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off?.("resize", onResize);
    };
  }, [stdout]);

  return size;
}
