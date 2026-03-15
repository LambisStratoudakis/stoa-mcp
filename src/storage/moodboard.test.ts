import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readMoodboard } from "./moodboard.js";

const TEST_ROOT = join(tmpdir(), "stoa-moodboard-test-" + Date.now());

async function setup(
  files: Record<string, string | Buffer>,
): Promise<string> {
  const root = join(TEST_ROOT, String(Math.random()).slice(2));
  const moodDir = join(root, ".stoa", "moodboard");
  await mkdir(moodDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(moodDir, name), content);
  }
  return root;
}

afterEach(async () => {
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("readMoodboard", () => {
  it("returns null when moodboard dir does not exist", async () => {
    const result = await readMoodboard(join(TEST_ROOT, "nonexistent"));
    assert.equal(result, null);
  });

  it("returns null for empty moodboard dir", async () => {
    const root = await setup({});
    const result = await readMoodboard(root);
    assert.equal(result, null);
  });

  it("throws TypeError for non-string projectRoot", async () => {
    await assert.rejects(
      () => readMoodboard("" as string),
      { name: "TypeError" },
    );
    await assert.rejects(
      () => readMoodboard(null as unknown as string),
      { name: "TypeError" },
    );
  });

  it("returns sections and imageFiles", async () => {
    const root = await setup({
      "notes.md": "# Colors\nPrimary: #E8C872\n\n# Layout\nSidebar left\n",
      "hero.png": "",
      "palette.jpg": "",
    });

    const result = await readMoodboard(root);
    assert.notEqual(result, null);
    assert.equal(result!.sections["Colors"], "Primary: #E8C872");
    assert.equal(result!.sections["Layout"], "Sidebar left");
    assert.deepEqual(result!.imageFiles, ["hero.png", "palette.jpg"]);
  });

  it("writes .snapshot with hash, imageFiles, and timestamp", async () => {
    const root = await setup({
      "notes.md": "# Colors\n#FF0000\n",
      "hero.png": "",
    });

    await readMoodboard(root);

    const raw = await readFile(
      join(root, ".stoa", "moodboard", ".snapshot"),
      "utf-8",
    );
    const snapshot = JSON.parse(raw);
    assert.ok(typeof snapshot.hash === "string");
    assert.equal(snapshot.hash.length, 64);
    assert.match(snapshot.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(snapshot.imageFiles, ["hero.png"]);
    assert.ok(typeof snapshot.timestamp === "string");
  });

  it("strips HTML comments from sections", async () => {
    const root = await setup({
      "notes.md": "# Colors\n<!-- Hex values -->\nPrimary: #000\n",
    });

    const result = await readMoodboard(root);
    assert.notEqual(result, null);
    assert.equal(result!.sections["Colors"], "Primary: #000");
    assert.ok(!JSON.stringify(result!.sections).includes("<!--"));
  });

  it("skips empty sections (template hints only)", async () => {
    const root = await setup({
      "notes.md": "# Colors\n<!-- Hex values -->\n\n# Layout\nSidebar left\n# Typography\n<!-- Sans-serif -->\n",
    });

    const result = await readMoodboard(root);
    assert.notEqual(result, null);
    assert.ok(!("Colors" in result!.sections));
    assert.equal(result!.sections["Layout"], "Sidebar left");
    assert.ok(!("Typography" in result!.sections));
  });

  it("returns null when notes.md has only template (all empty sections)", async () => {
    const root = await setup({
      "notes.md": "# Colors\n<!-- hints -->\n\n# Layout\n<!-- hints -->\n",
    });

    const result = await readMoodboard(root);
    assert.equal(result, null);
  });

  it("returns imageFiles when no notes.md", async () => {
    const root = await setup({
      "logo.svg": "<svg></svg>",
    });

    const result = await readMoodboard(root);
    assert.notEqual(result, null);
    assert.deepEqual(result!.imageFiles, ["logo.svg"]);
    assert.deepEqual(result!.sections, {});
  });

  it("handles case-insensitive image extensions", async () => {
    const root = await setup({
      "photo.PNG": "",
      "banner.JPEG": "",
    });

    const result = await readMoodboard(root);
    assert.notEqual(result, null);
    assert.deepEqual(result!.imageFiles, ["banner.JPEG", "photo.PNG"]);
  });

  it("ignores non-image files", async () => {
    const root = await setup({
      "notes.md": "# Colors\n#000\n",
      "data.json": "{}",
      "script.ts": "",
      "hero.png": "",
    });

    const result = await readMoodboard(root);
    assert.deepEqual(result!.imageFiles, ["hero.png"]);
  });

  it("sorts image filenames", async () => {
    const root = await setup({
      "z-last.png": "",
      "a-first.jpg": "",
      "m-middle.webp": "",
    });

    const result = await readMoodboard(root);
    assert.deepEqual(result!.imageFiles, [
      "a-first.jpg",
      "m-middle.webp",
      "z-last.png",
    ]);
  });
});
