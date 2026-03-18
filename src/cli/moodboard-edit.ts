import chalk from "chalk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { syncMoodboard } from "../storage/moodboard-sync.js";

function writeln(text = ""): void {
  process.stdout.write(text + "\n");
}

interface MoodboardSections {
  designDirection: string;
  colors: Record<string, string>;
  layout: string;
  typography: string;
  componentStyle: string;
  references: string;
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

function parseMoodboard(notesPath: string): MoodboardSections {
  const defaults: MoodboardSections = {
    designDirection: "",
    colors: {},
    layout: "",
    typography: "",
    componentStyle: "",
    references: "",
  };

  if (!existsSync(notesPath)) return defaults;

  const raw = readFileSync(notesPath, "utf-8");
  const sections: Record<string, string> = {};
  const parts = raw.split(/^# /m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx === -1) continue;
    const heading = trimmed.slice(0, newlineIdx).trim();
    const body = trimmed.slice(newlineIdx + 1).replace(HTML_COMMENT_RE, "").trim();
    if (body) sections[heading] = body;
  }

  // Parse colors
  const colors: Record<string, string> = {};
  if (sections["Colors"]) {
    const lines = sections["Colors"].split("\n");
    for (const line of lines) {
      const match = line.match(/^([A-Za-z][A-Za-z0-9 /]*?)\s*:\s*(#[0-9A-Fa-f]{6})\b/);
      if (match) {
        colors[match[1].trim()] = match[2];
      }
    }
  }

  return {
    designDirection: sections["Design Direction"] ?? "",
    colors,
    layout: sections["Layout"] ?? "",
    typography: sections["Typography"] ?? "",
    componentStyle: sections["Component Style"] ?? "",
    references: sections["References"] ?? "",
  };
}

const QUIT_COMMANDS = new Set(["q", "quit", "exit"]);

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      if (QUIT_COMMANDS.has(answer.trim().toLowerCase())) {
        resolve(null);
      } else {
        resolve(answer);
      }
    });
  });
}

export async function runMoodboardEdit(projectDir: string): Promise<void> {
  const notesPath = join(projectDir, ".stoa", "moodboard", "notes.md");
  const current = parseMoodboard(notesPath);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  writeln();
  writeln(chalk.bold("Edit Moodboard"));
  writeln(chalk.dim("Enter to keep current value. Type new value to replace. Type 'q' to quit."));
  writeln();

  let changed = false;

  // Helper to handle a text field
  async function editField(label: string, currentValue: string): Promise<string | "quit"> {
    writeln(chalk.bold(label));
    if (currentValue) {
      writeln(chalk.dim(`  Current: ${currentValue}`));
    }
    const answer = await prompt(rl, chalk.cyan("  New: "));
    if (answer === null) return "quit";
    if (answer.trim()) {
      writeln(chalk.green("  ✓ Updated"));
      return answer.trim();
    }
    writeln(chalk.dim("  ✓ Kept"));
    return currentValue;
  }

  // Design Direction
  const dir = await editField("Design Direction", current.designDirection);
  if (dir === "quit") { rl.close(); writeln(chalk.dim("\nCancelled.")); return; }
  if (dir !== current.designDirection) { current.designDirection = dir; changed = true; }
  writeln();

  // Colors
  writeln(chalk.bold("Colors"));
  const colorKeys = Object.keys(current.colors);
  if (colorKeys.length > 0) {
    for (const key of colorKeys) {
      const hex = current.colors[key];
      const swatch = chalk.hex(hex)("██");
      writeln(`  ${chalk.dim(key)}: ${swatch} ${chalk.dim(hex)}`);
      const newColor = await prompt(rl, chalk.cyan(`  New ${key}: `));
      if (newColor === null) { rl.close(); writeln(chalk.dim("\nCancelled.")); return; }
      if (newColor.trim()) {
        if (/^#[0-9A-Fa-f]{6}$/.test(newColor.trim())) {
          current.colors[key] = newColor.trim();
          changed = true;
          writeln(chalk.green("  ✓ Updated"));
        } else {
          writeln(chalk.yellow("  ✗ Invalid hex (use #RRGGBB). Kept original."));
        }
      } else {
        writeln(chalk.dim("  ✓ Kept"));
      }
    }
  } else {
    writeln(chalk.dim("  No colors defined. Add them in format: Label: #HEXVAL"));
  }

  // Add new color?
  const addColor = await prompt(rl, chalk.cyan("  Add new color? (name: #hex or Enter to skip): "));
  if (addColor === null) { rl.close(); writeln(chalk.dim("\nCancelled.")); return; }
  if (addColor.trim()) {
    const match = addColor.match(/^([A-Za-z][A-Za-z0-9 ]*?)\s*:\s*(#[0-9A-Fa-f]{6})$/);
    if (match) {
      current.colors[match[1].trim()] = match[2];
      changed = true;
      writeln(chalk.green(`  ✓ Added ${match[1].trim()}`));
    } else {
      writeln(chalk.yellow("  ✗ Format: Name: #HEXVAL"));
    }
  }
  writeln();

  // Typography
  const typo = await editField("Typography", current.typography);
  if (typo === "quit") { rl.close(); writeln(chalk.dim("\nCancelled.")); return; }
  if (typo !== current.typography) { current.typography = typo; changed = true; }
  writeln();

  // Layout
  const layout = await editField("Layout", current.layout);
  if (layout === "quit") { rl.close(); writeln(chalk.dim("\nCancelled.")); return; }
  if (layout !== current.layout) { current.layout = layout; changed = true; }
  writeln();

  // Component Style
  const style = await editField("Component Style", current.componentStyle);
  if (style === "quit") { rl.close(); writeln(chalk.dim("\nCancelled.")); return; }
  if (style !== current.componentStyle) { current.componentStyle = style; changed = true; }
  writeln();

  // References
  const refs = await editField("References", current.references);
  if (refs === "quit") { rl.close(); writeln(chalk.dim("\nCancelled.")); return; }
  if (refs !== current.references) { current.references = refs; changed = true; }

  rl.close();
  writeln();

  if (!changed) {
    writeln(chalk.dim("No changes made."));
    return;
  }

  // Write notes.md
  const colorLines = Object.entries(current.colors)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const markdown = `# Design Direction
${current.designDirection || ""}

# Colors
${colorLines || ""}

# Layout
${current.layout || ""}

# Typography
${current.typography || ""}

# Component Style
${current.componentStyle || ""}

# References
${current.references || ""}
`;

  writeFileSync(notesPath, markdown, "utf-8");
  writeln(chalk.green("✓ Saved to .stoa/moodboard/notes.md"));

  // Auto-sync tokens
  try {
    syncMoodboard(projectDir);
    writeln(chalk.green("✓ Synced tokens.json"));
  } catch {
    // Non-critical
  }
}
