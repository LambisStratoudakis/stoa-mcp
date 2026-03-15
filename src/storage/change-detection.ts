import { readFile } from "node:fs/promises";
import { join } from "node:path";

const STAGE_MAP: Record<string, readonly number[]> = {
  "01-problem-statement.md": [2, 3, 5],
  "02-acceptance-criteria.md": [3, 5],
  "03-constraints.md": [5],
  "user-notes.md": [1, 3, 5],
  "moodboard.md": [1, 3],
} as const;

export async function detectChanges(
  specDir: string,
  snapshot: Record<string, string>,
): Promise<number[]> {
  // Check all files in STAGE_MAP — not just snapshot keys.
  // Files absent from the snapshot but now present on disk are new (dirty).
  const filenames = Object.keys(STAGE_MAP);

  const results = await Promise.all(
    filenames.map(async (filename) => {
      let current: string | null;
      try {
        current = await readFile(join(specDir, filename), "utf-8");
      } catch {
        current = null;
      }

      const prev = snapshot[filename];

      // File didn't exist before and still doesn't — no change
      if (prev === undefined && current === null) {
        return [];
      }

      // File is new (didn't exist in snapshot but exists now)
      if (prev === undefined && current !== null) {
        process.stderr.write(`[change-detection] new: ${filename}\n`);
        return STAGE_MAP[filename] ?? [];
      }

      // File was deleted (existed in snapshot but gone now)
      if (prev !== undefined && current === null) {
        process.stderr.write(`[change-detection] deleted: ${filename}\n`);
        return STAGE_MAP[filename] ?? [];
      }

      // File content changed
      if (current !== prev) {
        process.stderr.write(`[change-detection] dirty: ${filename}\n`);
        return STAGE_MAP[filename] ?? [];
      }

      return [];
    }),
  );

  const stages = new Set(results.flat());
  return [...stages].sort((a, b) => a - b);
}
