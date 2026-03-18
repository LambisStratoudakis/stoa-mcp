import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toSlug } from "../utils/slug.js";
import { loadPreset, applyPreset } from "./moodboard-presets.js";

interface ProjectConfig {
  name: string;
  type: string;
  model: string;
  defaultRole?: string;
}

interface InitOptions {
  name: string;
  type: string;
  noTemplates?: boolean;
}

function getTemplatesDir(): string {
  return fileURLToPath(new URL("../../templates/", import.meta.url));
}

async function copyTemplates(stoaDir: string): Promise<string[]> {
  const templatesDir = getTemplatesDir();
  const copied: string[] = [];

  for (const subdir of ["roles", "guardrails"]) {
    const srcDir = join(templatesDir, subdir);
    const destDir = join(stoaDir, subdir);

    if (!existsSync(srcDir)) continue;

    await mkdir(destDir, { recursive: true });

    const files = await readdir(srcDir);
    for (const file of files) {
      const destPath = join(destDir, file);
      if (!existsSync(destPath)) {
        await copyFile(join(srcDir, file), destPath);
        copied.push(`${subdir}/${file}`);
      }
    }
  }

  return copied;
}

export async function initProject(name: string, type: string, noTemplates = false): Promise<boolean> {
  const stoaDir = join(process.cwd(), ".stoa");

  if (existsSync(stoaDir)) {
    process.stderr.write(".stoa/ already exists. Delete it to reinitialize.\n");
    return false;
  }

  await mkdir(stoaDir, { recursive: true });
  await mkdir(join(stoaDir, "roles"), { recursive: true });
  await mkdir(join(stoaDir, "guardrails"), { recursive: true });
  await mkdir(join(stoaDir, "scenarios"), { recursive: true });
  await mkdir(join(stoaDir, "specs"), { recursive: true });
  await mkdir(join(stoaDir, "moodboard"), { recursive: true });
  await mkdir(join(stoaDir, "presets"), { recursive: true });

  // Apply "clean" preset as default moodboard
  const cleanPreset = loadPreset(process.cwd(), "clean");
  if (cleanPreset) {
    applyPreset(process.cwd(), cleanPreset);
  } else {
    // Fallback if preset file missing
    await writeFile(
      join(stoaDir, "moodboard", "notes.md"),
      `# Design Direction
Clean, modern, minimal — inspired by Linear and Vercel

# Colors
Background: #FFFFFF
Surface: #FAFAFA
Border: #E5E7EB
Text: #111827
Text Secondary: #6B7280
Primary: #6366F1
Primary Hover: #4F46E5

# Layout
Single column centered, max-width 768px. Cards for grouped content.

# Typography
Sans-serif (Inter or system font). Large bold headings, regular weight body.

# Component Style
Rounded corners (8px). Subtle borders, no heavy shadows. Filled primary buttons, ghost secondary buttons.

# References
Linear, Notion, Vercel
`,
      "utf-8",
    );
  }

  // Create context.md (brand voice + dependencies + conventions in one file)
  await writeFile(
    join(stoaDir, "context.md"),
    `# Project Context

## Brand Voice
<!-- How should the app talk? E.g. "Friendly, not robotic. Use 'Save' not 'Submit'." -->

## Dependencies
<!-- Libraries to use and avoid. E.g. "Use date-fns, not moment. Use zustand, not redux." -->

## UI Library
<!-- E.g. "HeroUI (https://www.heroui.com) — buttons, inputs, cards, modals" -->

## Code Conventions
<!-- E.g. "PascalCase components. One component per file. Test files next to source." -->
`,
    "utf-8",
  );

  // Create lessons.md
  await writeFile(
    join(stoaDir, "lessons.md"),
    `# Lessons Learned

<!-- This file grows over time. After a failed build or fix, add what went wrong and how to prevent it. -->
<!-- Each entry becomes a constraint in future refines, preventing the same mistake twice. -->
`,
    "utf-8",
  );

  const config: ProjectConfig = {
    name: toSlug(name),
    type,
    model: "claude-sonnet-4-6",
    defaultRole: "builder",
  };

  await writeFile(
    join(stoaDir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );

  if (!noTemplates) {
    await copyTemplates(stoaDir);
  }

  return true;
}

export async function loadConfig(): Promise<ProjectConfig> {
  const configPath = join(process.cwd(), ".stoa", "config.json");
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw) as ProjectConfig;
}
