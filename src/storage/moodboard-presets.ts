import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncMoodboard } from "./moodboard-sync.js";

export interface PresetColors {
  background: string;
  surface: string;
  border: string;
  text: string;
  text_secondary: string;
  primary: string;
  primary_hover: string;
  [key: string]: string;
}

export interface MoodboardPreset {
  name: string;
  description: string;
  designDirection: string;
  colors: PresetColors;
  typography: string;
  layout: string;
  componentStyle: string;
  references: string;
}

export interface PresetEntry {
  id: string;
  preset: MoodboardPreset;
  isCustom: boolean;
}

function getBuiltinPresetsDir(): string {
  return fileURLToPath(new URL("../../templates/moodboard-presets/", import.meta.url));
}

function getCustomPresetsDir(projectDir: string): string {
  return join(projectDir, ".stoa", "presets");
}

function loadPresetFile(filePath: string): MoodboardPreset | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as MoodboardPreset;
  } catch {
    return null;
  }
}

export function listPresets(projectDir: string): PresetEntry[] {
  const entries: PresetEntry[] = [];

  // Built-in presets
  const builtinDir = getBuiltinPresetsDir();
  if (existsSync(builtinDir)) {
    const files = readdirSync(builtinDir)
      .filter((f) => extname(f) === ".json")
      .sort();
    for (const file of files) {
      const preset = loadPresetFile(join(builtinDir, file));
      if (preset) {
        entries.push({
          id: basename(file, ".json"),
          preset,
          isCustom: false,
        });
      }
    }
  }

  // Custom presets
  const customDir = getCustomPresetsDir(projectDir);
  if (existsSync(customDir)) {
    const files = readdirSync(customDir)
      .filter((f) => extname(f) === ".json")
      .sort();
    for (const file of files) {
      const preset = loadPresetFile(join(customDir, file));
      if (preset) {
        entries.push({
          id: basename(file, ".json"),
          preset,
          isCustom: true,
        });
      }
    }
  }

  return entries;
}

export function loadPreset(projectDir: string, name: string): MoodboardPreset | null {
  // Check custom first
  const customPath = join(getCustomPresetsDir(projectDir), `${name}.json`);
  if (existsSync(customPath)) {
    return loadPresetFile(customPath);
  }

  // Then built-in
  const builtinPath = join(getBuiltinPresetsDir(), `${name}.json`);
  if (existsSync(builtinPath)) {
    return loadPresetFile(builtinPath);
  }

  return null;
}

export function presetToNotesMarkdown(preset: MoodboardPreset): string {
  const colorLines = Object.entries(preset.colors)
    .map(([key, value]) => {
      const label = key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return `${label}: ${value}`;
    })
    .join("\n");

  return `# Design Direction
${preset.designDirection}

# Colors
${colorLines}

# Layout
${preset.layout}

# Typography
${preset.typography}

# Component Style
${preset.componentStyle}

# References
${preset.references}
`;
}

export function applyPreset(projectDir: string, preset: MoodboardPreset): void {
  const moodboardDir = join(projectDir, ".stoa", "moodboard");
  mkdirSync(moodboardDir, { recursive: true });

  const notesPath = join(moodboardDir, "notes.md");
  const markdown = presetToNotesMarkdown(preset);
  writeFileSync(notesPath, markdown, "utf-8");

  // Auto-sync tokens
  try {
    syncMoodboard(projectDir);
  } catch {
    // Non-critical
  }
}

export function savePreset(projectDir: string, name: string): MoodboardPreset {
  const moodboardDir = join(projectDir, ".stoa", "moodboard");
  const notesPath = join(moodboardDir, "notes.md");

  if (!existsSync(notesPath)) {
    throw new Error("No moodboard/notes.md found. Run 'stoa init' first.");
  }

  // Try to load tokens.json for structured data
  const tokensPath = join(moodboardDir, "tokens.json");
  let tokens: Record<string, unknown> = {};
  if (existsSync(tokensPath)) {
    try {
      tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
    } catch {
      // ignore
    }
  }

  // Parse notes.md sections
  const raw = readFileSync(notesPath, "utf-8");
  const sections: Record<string, string> = {};
  const parts = raw.split(/^# /m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx === -1) continue;
    const heading = trimmed.slice(0, newlineIdx).trim();
    const body = trimmed.slice(newlineIdx + 1).replace(/<!--[\s\S]*?-->/g, "").trim();
    if (body) sections[heading] = body;
  }

  const preset: MoodboardPreset = {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    description: "Custom preset",
    designDirection: sections["Design Direction"] ?? "",
    colors: (tokens.colors as PresetColors) ?? {},
    typography: sections["Typography"] ?? "",
    layout: sections["Layout"] ?? "",
    componentStyle: sections["Component Style"] ?? "",
    references: sections["References"] ?? "",
  };

  const presetsDir = getCustomPresetsDir(projectDir);
  mkdirSync(presetsDir, { recursive: true });
  writeFileSync(
    join(presetsDir, `${name}.json`),
    JSON.stringify(preset, null, 2) + "\n",
    "utf-8",
  );

  return preset;
}
