import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveSpecName, snapshotSpecFiles, SpecNotFoundError } from "./spec-helpers.js";

const TEST_ROOT = join(process.cwd(), ".stoa-test-helpers");
const SPECS_DIR = join(TEST_ROOT, ".stoa", "specs");

describe("resolveSpecName", () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("returns the provided name when given", async () => {
    const result = await resolveSpecName("my-spec");
    assert.equal(result, "my-spec");
  });

  it("throws SpecNotFoundError when .stoa/specs/ does not exist", async () => {
    const originalCwd = process.cwd();
    await mkdir(TEST_ROOT, { recursive: true });
    process.chdir(TEST_ROOT);

    try {
      await assert.rejects(
        () => resolveSpecName(),
        (err: unknown) => {
          assert.ok(err instanceof SpecNotFoundError);
          assert.equal(err.message, "No specs found. Run stoa refine <task> first.");
          assert.equal(err.code, "NO_SPECS");
          return true;
        },
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("throws SpecNotFoundError when .stoa/specs/ has no subdirectories", async () => {
    const originalCwd = process.cwd();
    await mkdir(SPECS_DIR, { recursive: true });
    await writeFile(join(SPECS_DIR, "some-file.txt"), "not a dir");
    process.chdir(TEST_ROOT);

    try {
      await assert.rejects(
        () => resolveSpecName(),
        (err: unknown) => {
          assert.ok(err instanceof SpecNotFoundError);
          return true;
        },
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("returns the most recently modified subdirectory", async () => {
    const originalCwd = process.cwd();
    await mkdir(join(SPECS_DIR, "older-spec"), { recursive: true });

    // Small delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 50));
    await mkdir(join(SPECS_DIR, "newer-spec"), { recursive: true });

    process.chdir(TEST_ROOT);

    try {
      const result = await resolveSpecName();
      assert.equal(result, "newer-spec");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("snapshotSpecFiles", () => {
  const specDir = join(TEST_ROOT, "test-spec");

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(specDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("returns only filenames that exist on disk", async () => {
    await writeFile(join(specDir, "01-problem-statement.md"), "# My Description");
    await writeFile(join(specDir, "02-acceptance-criteria.md"), "## Criteria");

    const result = await snapshotSpecFiles(specDir);

    assert.ok("01-problem-statement.md" in result);
    assert.ok("02-acceptance-criteria.md" in result);
    assert.ok(!("03-constraints.md" in result));
    assert.ok(!("04-decomposition.md" in result));
    assert.ok(!("05-evaluation-design.md" in result));
    assert.ok(!("user-notes.md" in result));
    assert.ok(!("moodboard.md" in result));
    assert.equal(Object.keys(result).length, 2);
  });

  it("returns all 7 keys when all files are present", async () => {
    const allFiles = [
      "01-problem-statement.md",
      "02-acceptance-criteria.md",
      "03-constraints.md",
      "04-decomposition.md",
      "05-evaluation-design.md",
      "user-notes.md",
      "moodboard.md",
    ];

    for (const f of allFiles) {
      await writeFile(join(specDir, f), `Content of ${f}`);
    }

    const result = await snapshotSpecFiles(specDir);
    assert.equal(Object.keys(result).length, 7);

    for (const f of allFiles) {
      assert.ok(f in result);
      assert.equal(result[f], `Content of ${f}`);
    }
  });

  it("returns empty record when no recognized files exist", async () => {
    await writeFile(join(specDir, "unrecognized.md"), "content");

    const result = await snapshotSpecFiles(specDir);
    assert.equal(Object.keys(result).length, 0);
  });
});
