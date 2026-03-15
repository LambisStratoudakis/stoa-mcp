/**
 * Selective re-refine: prompt the user about affected stages and re-run them.
 * Called after change detection determines which pipeline stages need re-execution.
 */

import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { refinePipeline } from "../core/refine.js";
import type { RefineInput, RefineOptions } from "../core/refine.js";
import { STAGE_FILENAMES } from "../storage/specs.js";

export type StageRunner = (input: RefineInput, options: RefineOptions) => Promise<unknown>;

const STAGE_DISPLAY_NAMES: Record<number, string> = {
  1: "Problem Statement",
  2: "Acceptance Criteria",
  3: "Constraints",
  4: "Decomposition",
  5: "Evaluation Design",
};

function stageLabel(stage: number): string {
  return STAGE_DISPLAY_NAMES[stage] ?? `Stage ${stage}`;
}

function askLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function askChar(prompt: string): Promise<string> {
  const answer = await askLine(prompt);
  return answer.toLowerCase();
}

async function loadSpecMeta(specDir: string): Promise<{ title: string }> {
  try {
    const raw = await readFile(join(specDir, ".refine-meta.json"), "utf-8");
    const meta = JSON.parse(raw) as { title?: string };
    return { title: meta.title ?? "" };
  } catch {
    return { title: "" };
  }
}

async function loadStageOutput(specDir: string, stage: number): Promise<string> {
  const filename = STAGE_FILENAMES[stage] ?? `stage-${stage}.md`;
  try {
    return await readFile(join(specDir, filename), "utf-8");
  } catch {
    return "";
  }
}

async function pickStages(affectedStages: number[]): Promise<number[] | null> {
  process.stderr.write("Select stages to re-run (comma-separated, e.g. 2,5):\n");
  for (const s of affectedStages) {
    process.stderr.write(`  ${s}: ${stageLabel(s)}\n`);
  }

  const valid = new Set(affectedStages);
  let attempts = 0;

  while (attempts < 2) {
    const line = await askLine("> ");
    if (!line) {
      attempts++;
      if (attempts >= 2) return null;
      process.stderr.write("Invalid input. Try again.\n");
      continue;
    }

    const tokens = line.split(",").map((t) => t.trim());
    const parsed: number[] = [];
    let allValid = true;

    for (const token of tokens) {
      const num = Number(token);
      if (!Number.isInteger(num) || !valid.has(num)) {
        allValid = false;
        break;
      }
      parsed.push(num);
    }

    if (allValid && parsed.length > 0) {
      return [...new Set(parsed)].sort((a, b) => a - b);
    }

    attempts++;
    if (attempts >= 2) return null;
    process.stderr.write("Invalid input. Try again.\n");
  }

  return null;
}

export async function promptAndRerun(
  affectedStages: number[],
  specDir: string,
  runStage: StageRunner = refinePipeline,
): Promise<boolean> {
  if (affectedStages.length === 0) {
    return true;
  }

  const sorted = [...affectedStages].sort((a, b) => a - b);

  process.stderr.write(`Changes detected. Affected stages: [${sorted.join(", ")}]\n`);
  process.stderr.write("Re-run affected stages? [y] yes  [n] no  [p] pick\n");

  const choice = await askChar("");

  let stagesToRun: number[];

  if (choice === "n") {
    return true;
  } else if (choice === "p") {
    const picked = await pickStages(sorted);
    if (picked === null) {
      process.stderr.write("Aborted.\n");
      return false;
    }
    stagesToRun = picked;
  } else if (choice === "y") {
    stagesToRun = sorted;
  } else {
    process.stderr.write("Unrecognized input. Aborting.\n");
    return false;
  }

  // Load existing spec data to build RefineInput
  const meta = await loadSpecMeta(specDir);
  const description = await loadStageOutput(specDir, 1);

  const input: RefineInput = {
    title: meta.title,
    description: description || meta.title,
  };

  // Run each stage individually to support per-stage failure handling
  for (let i = 0; i < stagesToRun.length; i++) {
    const stage = stagesToRun[i];

    process.stderr.write(`Running stage ${stage}: ${stageLabel(stage)}...\n`);

    const options: RefineOptions = {
      stages: [stage as 1 | 2 | 3 | 4 | 5],
      onStageComplete: (_s: number, result) => {
        process.stderr.write(`Stage ${stage} complete (score: ${result.specScore}/5)\n`);
      },
    };

    try {
      await runStage(input, options);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Stage ${stage} failed. ${message}\n`);

      // If there are remaining stages, ask whether to continue
      if (i < stagesToRun.length - 1) {
        process.stderr.write("Continue remaining stages? [y/n] ");
        const cont = await askChar("");
        if (cont !== "y") {
          return false;
        }
        continue;
      }

      return false;
    }
  }

  return true;
}
