import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export class InvalidSpecNameError extends Error {
  readonly code = "INVALID_SPEC_NAME" as const;

  constructor(message: string = "Invalid spec name") {
    super(message);
    this.name = "InvalidSpecNameError";
  }
}

export function validateSpecName(name: string): void {
  if (name === "" || name.trim() === "") {
    throw new InvalidSpecNameError("Spec name must not be empty");
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new InvalidSpecNameError("Spec name must not contain path separators");
  }
}

export class SpecNotFoundError extends Error {
  readonly code = "NO_SPECS" as const;

  constructor(message: string = "No specs found. Run stoa refine <task> first.") {
    super(message);
    this.name = "SpecNotFoundError";
  }
}

export async function resolveSpecName(name?: string): Promise<string> {
  if (name !== undefined) {
    validateSpecName(name);
    return name;
  }

  const specsDir = join(process.cwd(), ".stoa", "specs");

  let entries: string[];
  try {
    entries = await readdir(specsDir);
  } catch {
    throw new SpecNotFoundError();
  }

  const dirs: { name: string; mtime: number }[] = [];

  for (const entry of entries) {
    const s = await stat(join(specsDir, entry));
    if (s.isDirectory()) {
      dirs.push({ name: entry, mtime: s.mtimeMs });
    }
  }

  if (dirs.length === 0) {
    throw new SpecNotFoundError();
  }

  dirs.sort((a, b) => b.mtime - a.mtime);
  return dirs[0].name;
}

const SPEC_FILES = [
  "01-problem-statement.md",
  "02-acceptance-criteria.md",
  "03-constraints.md",
  "04-decomposition.md",
  "05-evaluation-design.md",
  "user-notes.md",
  "moodboard.md",
] as const;

const FrontMatterSchema = z.object({}).passthrough();

function hasYamlFrontMatter(content: string): boolean {
  return content.startsWith("---\n") || content.startsWith("---\r\n");
}

function isJsonContent(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export async function snapshotSpecFiles(
  specDir: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const filename of SPEC_FILES) {
    const filePath = join(specDir, filename);
    let content: string;

    try {
      content = await readFile(filePath, "utf-8");
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue;
      }
      throw err;
    }

    if (hasYamlFrontMatter(content)) {
      FrontMatterSchema.parse({});
    } else if (isJsonContent(content)) {
      z.record(z.string(), z.unknown()).parse(JSON.parse(content));
    }

    result[filename] = content;
  }

  return result;
}
