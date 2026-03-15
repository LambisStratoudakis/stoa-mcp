import { readFile, readdir, writeFile, access } from "node:fs/promises";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";

import type { MoodboardContext } from "../core/prompts.js";

// Re-export so consumers can import from storage
export type { MoodboardContext } from "../core/prompts.js";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

function parseSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = raw.split(/^# /m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx === -1) continue; // heading only, no body

    const heading = trimmed.slice(0, newlineIdx).trim();
    const body = trimmed
      .slice(newlineIdx + 1)
      .replace(HTML_COMMENT_RE, "")
      .trim();

    if (body.length > 0) {
      sections[heading] = body;
    }
  }

  return sections;
}

export async function readMoodboard(
  projectRoot: string,
): Promise<MoodboardContext | null> {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError("projectRoot must be a non-empty string");
  }

  const moodboardDir = join(projectRoot, ".stoa", "moodboard");

  try {
    await access(moodboardDir);
  } catch {
    return null;
  }

  let sections: Record<string, string> = {};
  try {
    const raw = await readFile(join(moodboardDir, "notes.md"), "utf-8");
    sections = parseSections(raw);
  } catch {
    // notes.md absent — treat as empty
  }

  const entries = await readdir(moodboardDir);
  const imageFiles = entries
    .filter((f) => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort();

  if (imageFiles.length === 0 && Object.keys(sections).length === 0) {
    return null;
  }

  const context: MoodboardContext = { sections, imageFiles };

  // Write .snapshot with hash + image list + timestamp
  const hashInput = JSON.stringify({ sections, imageFiles });
  const hash = createHash("sha256").update(hashInput).digest("hex");
  const snapshot = JSON.stringify(
    { hash, imageFiles, timestamp: new Date().toISOString() },
    null,
    2,
  );
  await writeFile(join(moodboardDir, ".snapshot"), snapshot, "utf-8");

  return context;
}
