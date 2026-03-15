import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";

import { promptAndRerun } from "./rerefine.js";
import type { StageRunner } from "./rerefine.js";
import type { RefineOptions } from "../core/refine.js";

const TEST_ROOT = join(tmpdir(), "stoa-rerefine-test-" + Date.now());

let executedStages: number[] = [];
let failingStages: Set<number> = new Set();

const stubRunner: StageRunner = async (_input, options: RefineOptions) => {
  const stage = options.stages?.[0];
  if (stage == null) throw new Error("No stage specified");

  if (failingStages.has(stage)) {
    throw new Error(`Stage ${stage} execution error`);
  }

  executedStages.push(stage);

  const result = { stage, output: `output-${stage}`, specScore: 3, rawResponse: `raw-${stage}` };
  options.onStageComplete?.(stage, result);

  return {
    stages: [result],
    finalSpecScore: 3,
    finalOutput: result.output,
    executionMode: "clipboard" as const,
  };
};

async function setupSpecDir(stages: Record<number, string> = {}): Promise<string> {
  const dir = join(TEST_ROOT, String(Math.random()).slice(2));
  await mkdir(dir, { recursive: true });

  const meta = { title: "Test Task", stages_run: Object.keys(stages).map(Number) };
  await writeFile(join(dir, ".refine-meta.json"), JSON.stringify(meta), "utf-8");

  for (const [num, content] of Object.entries(stages)) {
    await writeFile(join(dir, `stage-${num}.md`), content, "utf-8");
  }

  return dir;
}

function simulateStdin(inputs: string[]): void {
  const fake = new PassThrough();

  Object.defineProperty(process, "stdin", {
    value: fake,
    writable: true,
    configurable: true,
  });

  for (const line of inputs) {
    fake.push(line + "\n");
  }
  fake.push(null);
}

let originalStdin: typeof process.stdin;

beforeEach(() => {
  executedStages = [];
  failingStages = new Set();
  originalStdin = process.stdin;
});

afterEach(async () => {
  Object.defineProperty(process, "stdin", {
    value: originalStdin,
    writable: true,
    configurable: true,
  });
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("promptAndRerun", () => {
  it("returns true immediately for empty affectedStages", async () => {
    const dir = await setupSpecDir();
    const result = await promptAndRerun([], dir, stubRunner);
    assert.equal(result, true);
    assert.deepEqual(executedStages, []);
  });

  it("runs all affected stages when user answers y", async () => {
    const dir = await setupSpecDir({ 1: "problem statement" });
    simulateStdin(["y"]);

    const result = await promptAndRerun([2, 3, 5], dir, stubRunner);
    assert.equal(result, true);
    assert.deepEqual(executedStages, [2, 3, 5]);
  });

  it("runs no stages when user answers n", async () => {
    const dir = await setupSpecDir({ 1: "problem statement" });
    simulateStdin(["n"]);

    const result = await promptAndRerun([2, 3, 5], dir, stubRunner);
    assert.equal(result, true);
    assert.deepEqual(executedStages, []);
  });

  it("runs only picked stages when user answers p then selects subset", async () => {
    const dir = await setupSpecDir({ 1: "problem statement" });
    simulateStdin(["p", "2,5"]);

    const result = await promptAndRerun([2, 3, 5], dir, stubRunner);
    assert.equal(result, true);
    assert.deepEqual(executedStages, [2, 5]);
  });

  it("returns false when stage fails and user declines to continue", async () => {
    const dir = await setupSpecDir({ 1: "problem statement" });
    failingStages.add(2);
    simulateStdin(["y", "n"]);

    const result = await promptAndRerun([2, 3, 5], dir, stubRunner);
    assert.equal(result, false);
    // Stage 2 failed so it was never added to executedStages
    assert.deepEqual(executedStages, []);
  });

  it("continues after failure when user answers y to continue prompt", async () => {
    const dir = await setupSpecDir({ 1: "problem statement" });
    failingStages.add(2);
    simulateStdin(["y", "y"]);

    const result = await promptAndRerun([2, 3, 5], dir, stubRunner);
    assert.equal(result, true);
    // Stage 2 failed (not in executedStages), stages 3 and 5 succeeded
    assert.deepEqual(executedStages, [3, 5]);
  });

  it("aborts pick mode after two invalid inputs", async () => {
    const dir = await setupSpecDir({ 1: "problem statement" });
    simulateStdin(["p", "99", ""]);

    const result = await promptAndRerun([2, 3, 5], dir, stubRunner);
    assert.equal(result, false);
    assert.deepEqual(executedStages, []);
  });
});
