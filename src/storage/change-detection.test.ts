import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectChanges } from "./change-detection.js";

const TEST_ROOT = join(tmpdir(), "stoa-change-detect-test-" + Date.now());

async function setup(files: Record<string, string>): Promise<string> {
  const dir = join(TEST_ROOT, String(Math.random()).slice(2));
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf-8");
  }
  return dir;
}

afterEach(async () => {
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("detectChanges", () => {
  it("returns deduplicated sorted stages for multi-file mutation", async () => {
    const dir = await setup({
      "01-problem-statement.md": "changed description",
      "user-notes.md": "changed notes",
    });

    const snapshot: Record<string, string> = {
      "01-problem-statement.md": "original description",
      "user-notes.md": "original notes",
    };

    const result = await detectChanges(dir, snapshot);
    // 01-problem-statement.md → [2, 3, 5], user-notes.md → [1, 3, 5]
    // combined deduplicated sorted: [1, 2, 3, 5]
    assert.deepEqual(result, [1, 2, 3, 5]);
  });

  it("returns stages for single-file mutation", async () => {
    const dir = await setup({
      "03-constraints.md": "changed constraints",
    });

    const snapshot: Record<string, string> = {
      "03-constraints.md": "original constraints",
    };

    const result = await detectChanges(dir, snapshot);
    assert.deepEqual(result, [5]);
  });

  it("returns empty array when no changes", async () => {
    const content = "same content";
    const dir = await setup({
      "01-problem-statement.md": content,
      "02-acceptance-criteria.md": content,
    });

    const snapshot: Record<string, string> = {
      "01-problem-statement.md": content,
      "02-acceptance-criteria.md": content,
    };

    const result = await detectChanges(dir, snapshot);
    assert.deepEqual(result, []);
  });

  it("treats missing files as changed", async () => {
    const dir = await setup({});

    const snapshot: Record<string, string> = {
      "01-problem-statement.md": "was here",
    };

    const result = await detectChanges(dir, snapshot);
    assert.deepEqual(result, [2, 3, 5]);
  });

  it("skips unrecognized filenames silently", async () => {
    const dir = await setup({
      "unknown.md": "changed",
    });

    const snapshot: Record<string, string> = {
      "unknown.md": "original",
    };

    const result = await detectChanges(dir, snapshot);
    assert.deepEqual(result, []);
  });
});
