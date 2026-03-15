import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatDescription,
  formatAcceptanceCriteria,
  formatConstraints,
  formatSubtasks,
  formatScenarios,
} from "../formatters/index.js";

type StageFormatter = (raw: string) => string;

const STAGE_FORMATTERS: Record<number, StageFormatter> = {
  1: formatDescription,
  2: formatAcceptanceCriteria,
  3: formatConstraints,
  4: formatSubtasks,
  5: formatScenarios,
};

export const STAGE_FILENAMES: Record<number, string> = {
  1: "01-problem-statement.md",
  2: "02-acceptance-criteria.md",
  3: "03-constraints.md",
  4: "04-decomposition.md",
  5: "05-evaluation-design.md",
};

export async function writeSpecFiles(
  specsDir: string,
  slug: string,
  stagesRun: Record<number, string>,
): Promise<void> {
  const specDir = join(specsDir, slug);
  await mkdir(specDir, { recursive: true });

  const sortedKeys: number[] = Object.keys(stagesRun)
    .map(Number)
    .sort((a, b) => a - b);

  for (const num of sortedKeys) {
    const raw = stagesRun[num];
    if (!raw || !raw.trim()) continue;

    const formatter = STAGE_FORMATTERS[num];
    const formatted = formatter ? formatter(raw) : raw;

    const filename = STAGE_FILENAMES[num] ?? `stage-${num}.md`;
    await writeFile(
      join(specDir, filename),
      formatted + "\n",
      "utf-8",
    );
  }
}

export interface RefineMeta {
  timestamps: Record<string, string>;
  stages_run: number[];
  mode: string;
  version: string;
}

export async function writeRefineMeta(
  specsDir: string,
  slug: string,
  stagesRun: number[],
  mode: string,
  version: string,
): Promise<void> {
  const specDir = join(specsDir, slug);
  await mkdir(specDir, { recursive: true });

  const now = new Date().toISOString();
  const timestamps: Record<string, string> = {
    created: now,
  };
  for (const stage of stagesRun) {
    timestamps[`stage_${stage}`] = now;
  }

  const meta: RefineMeta = {
    timestamps,
    stages_run: stagesRun,
    mode,
    version,
  };

  await writeFile(
    join(specDir, ".refine-meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf-8",
  );
}

export interface SpecSummary {
  name: string;
  date: Date;
  stages: number;
}

export async function listSpecs(specsDir: string): Promise<SpecSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(specsDir);
  } catch {
    return [];
  }

  const results: SpecSummary[] = [];

  for (const entry of entries) {
    const entryPath = join(specsDir, entry);
    const s = await stat(entryPath);
    if (!s.isDirectory()) continue;

    // Count stage files
    let stageCount = 0;
    try {
      const files = await readdir(entryPath);
      stageCount = files.filter((f) => f.endsWith(".md")).length;
    } catch {
      // skip unreadable dirs
    }

    results.push({
      name: entry,
      date: s.mtime,
      stages: stageCount,
    });
  }

  results.sort((a, b) => b.date.getTime() - a.date.getTime());
  return results;
}

export async function showSpec(
  specsDir: string,
  name: string,
): Promise<string> {
  const specDir = join(specsDir, name);

  let entries: string[];
  try {
    entries = await readdir(specDir);
  } catch {
    throw new Error(`Spec not found: ${name}`);
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  if (mdFiles.length === 0) {
    throw new Error(`Spec "${name}" has no markdown files`);
  }

  const parts: string[] = [];
  for (const file of mdFiles) {
    const content = await readFile(join(specDir, file), "utf-8");
    parts.push(content.trimEnd());
  }

  return parts.join("\n\n---\n\n") + "\n";
}
