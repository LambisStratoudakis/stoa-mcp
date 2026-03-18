import chalk from "chalk";
import type { PresetEntry } from "../storage/moodboard-presets.js";

function writeln(text = ""): void {
  process.stdout.write(text + "\n");
}

function clearLines(count: number): void {
  for (let i = 0; i < count; i++) {
    process.stdout.write("\x1B[1A\x1B[2K");
  }
}

function renderPreview(entry: PresetEntry): string[] {
  const { preset } = entry;
  const lines: string[] = [];
  const c = preset.colors;

  // Color swatches line
  const colorPairs = [
    ["Bg", c.background],
    ["Primary", c.primary],
    ["Text", c.text],
    ["Border", c.border],
  ].filter(([, v]) => v);

  const colorLine = colorPairs
    .map(([label, hex]) => `${label}: ${chalk.hex(hex as string)("██")} ${chalk.dim(hex)}`)
    .join("  ");

  lines.push(`    ${colorLine}`);
  lines.push(`    ${chalk.dim(preset.typography.split(".")[0])}`);
  lines.push(`    ${chalk.dim(preset.componentStyle.split(".")[0])}`);
  lines.push(`    ${chalk.dim(`Like: ${preset.references}`)}`);

  return lines;
}

function render(entries: PresetEntry[], selected: number): number {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold("Choose a style preset:"));
  lines.push("");

  let builtinDone = false;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Separator between built-in and custom
    if (entry.isCustom && !builtinDone) {
      builtinDone = true;
      lines.push("  " + chalk.dim("─".repeat(40)));
    }

    const isSelected = i === selected;
    const marker = isSelected ? chalk.cyan("● ") : "  ";
    const name = isSelected ? chalk.cyan.bold(entry.preset.name) : entry.preset.name;
    const desc = chalk.dim(entry.preset.description);
    const tag = entry.isCustom ? chalk.dim(" (custom)") : "";

    lines.push(`  ${marker}${name}  ${desc}${tag}`);

    // Show preview for selected
    if (isSelected) {
      const preview = renderPreview(entry);
      lines.push(...preview);
      lines.push("");
    }
  }

  lines.push(chalk.dim("  ↑↓ navigate  Enter apply  q cancel"));
  lines.push("");

  for (const line of lines) {
    writeln(line);
  }

  return lines.length;
}

function waitForKey(): Promise<string> {
  return new Promise((resolve) => {
    const { stdin } = process;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      resolve("q");
      return;
    }
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.once("data", (data: Buffer) => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      resolve(data.toString());
    });
  });
}

export async function pickPreset(entries: PresetEntry[]): Promise<PresetEntry | null> {
  if (entries.length === 0) {
    writeln(chalk.red("No presets found."));
    return null;
  }

  if (!process.stdin.isTTY) {
    writeln(chalk.red("Interactive preset picker requires a TTY terminal."));
    return null;
  }

  let selected = 0;
  let lastLineCount = 0;

  // Initial render
  lastLineCount = render(entries, selected);

  while (true) {
    const key = await waitForKey();

    // Ctrl+C
    if (key === "\x03") {
      return null;
    }

    // q to cancel
    if (key === "q") {
      return null;
    }

    // Enter to select
    if (key === "\r" || key === "\n") {
      return entries[selected];
    }

    // Arrow keys (escape sequences)
    if (key === "\x1B[A" || key === "k") {
      // Up
      if (selected > 0) {
        selected--;
        clearLines(lastLineCount);
        lastLineCount = render(entries, selected);
      }
    } else if (key === "\x1B[B" || key === "j") {
      // Down
      if (selected < entries.length - 1) {
        selected++;
        clearLines(lastLineCount);
        lastLineCount = render(entries, selected);
      }
    }
  }
}
