// Test helper: poll until a condition holds, instead of sleeping a fixed amount
// and hoping the render happened. Fixed `delay()`s race on slow/shared CI
// runners (the Ink frame may not be ready yet); polling waits exactly as long as
// needed and no longer. Not a *.test.* file, so the runner won't execute it.

export async function waitFor(
  condition: () => boolean,
  { timeout = 8000, interval = 15 }: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (condition()) return;
    if (Date.now() - start >= timeout) {
      throw new Error(`waitFor: condition not met within ${timeout}ms`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
