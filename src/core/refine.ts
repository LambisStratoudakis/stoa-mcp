/**
 * Refine Pipeline orchestrator.
 * Runs a 5-stage refinement pipeline that transforms raw task descriptions
 * into structured specifications.
 */

import Anthropic from "@anthropic-ai/sdk";
import { spawn, execFileSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";

import {
  buildProblemStatementPrompt,
  buildAcceptanceCriteriaPrompt,
  buildConstraintPrompt,
  buildDecompositionPrompt,
  buildEvaluationDesignPrompt,
  buildMoodboardPrompt,
} from "./prompts.js";
import type { PromptOptions, MoodboardContext, ProjectContext } from "./prompts.js";

import {
  stripPreamble,
  parseAcceptanceCriteria,
  parseConstraints,
  parseDecomposition,
  parseScenarios,
} from "./parsers.js";

import { computeSpecScore } from "./spec-score.js";
import type { SpecScoreInput } from "./spec-score.js";

const DEFAULT_TIMEOUT_MS = 300_000;

// ── Types ──────────────────────────────────────────────────────────────

export interface RefineInput {
  title: string;
  description: string;
  projectContext?: string;
  designContext?: string;
  moodboard?: MoodboardContext;
  projectCtx?: ProjectContext;
  role?: string;
  guardrails?: string[];
  promptOptions?: PromptOptions;
}

export interface RefineOptions {
  executionMode?: "api" | "claude-code" | "clipboard";
  stages?: (1 | 2 | 3 | 4 | 5)[];
  onStageComplete?: (stage: number, result: StageResult) => void;
  model?: string;
  apiKey?: string;
}

export interface StageResult {
  stage: number;
  output: unknown;
  specScore: number;
  rawResponse: string;
}

export interface RefineResult {
  stages: StageResult[];
  finalSpecScore: number;
  finalOutput: unknown;
  executionMode: "api" | "claude-code" | "clipboard";
}

interface PromptPair {
  systemPrompt: string;
  userPrompt: string;
}

// ── Private helpers ────────────────────────────────────────────────────

function detectExecutionMode(options: RefineOptions): "api" | "claude-code" | "clipboard" {
  if (options.executionMode) {
    return options.executionMode;
  }

  if (options.apiKey || process.env.ANTHROPIC_API_KEY) {
    return "api";
  }

  try {
    execFileSync("which", ["claude"]);
    return "claude-code";
  } catch {
    return "clipboard";
  }
}

async function executePrompt(
  prompt: PromptPair,
  mode: "api" | "claude-code" | "clipboard",
  model: string,
  apiKey?: string,
): Promise<string> {
  if (mode === "clipboard") {
    return `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;
  }

  if (mode === "api") {
    const client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: prompt.systemPrompt,
      messages: [{ role: "user", content: prompt.userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock ? textBlock.text : "";
  }

  // claude-code mode — pipe prompt via stdin instead of -p flag
  // (claude --print -p "..." hangs as a subprocess; stdin works reliably)
  const combinedPrompt = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;

  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["--print"], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let resolved = false;
    let dataTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(overallTimer);
      if (dataTimer) clearTimeout(dataTimer);
      process.removeListener("SIGINT", onParentSigint);
      child.kill();
      resolve(stdout.trim());
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      // Reset idle timer on each chunk — after 2s of silence, assume done.
      // Claude Code writes the full response before SessionEnd hooks run.
      if (dataTimer) clearTimeout(dataTimer);
      dataTimer = setTimeout(finish, 2000);
    });

    child.on("close", () => {
      finish();
    });

    const overallTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (dataTimer) clearTimeout(dataTimer);
        process.removeListener("SIGINT", onParentSigint);
        child.kill("SIGKILL");
        reject(new Error(`Claude Code subprocess timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`));
      }
    }, DEFAULT_TIMEOUT_MS);

    const onParentSigint = (): void => {
      child.kill("SIGINT");
    };
    process.once("SIGINT", onParentSigint);

    child.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(overallTimer);
        if (dataTimer) clearTimeout(dataTimer);
        process.removeListener("SIGINT", onParentSigint);
        reject(err);
      }
    });

    // Write prompt to stdin and close it
    child.stdin.write(combinedPrompt);
    child.stdin.end();
  });
}

type PromptBuilder = (
  title: string,
  ...args: string[]
) => PromptPair;

const PROMPT_BUILDERS: Record<number, PromptBuilder> = {
  1: buildProblemStatementPrompt as unknown as PromptBuilder,
  2: buildAcceptanceCriteriaPrompt as PromptBuilder,
  3: buildConstraintPrompt as unknown as PromptBuilder,
  4: buildDecompositionPrompt as PromptBuilder,
  5: buildEvaluationDesignPrompt as PromptBuilder,
};

type Parser = (raw: string) => unknown;

const STAGE_PARSERS: Record<number, Parser> = {
  1: stripPreamble,
  2: parseAcceptanceCriteria,
  3: parseConstraints,
  4: parseDecomposition,
  5: parseScenarios,
};

function buildPromptForStage(
  stage: number,
  input: RefineInput,
  completedStages: StageResult[],
): PromptPair {
  const builder = PROMPT_BUILDERS[stage];
  if (!builder) {
    throw new Error(`Unknown stage: ${stage}`);
  }

  const findOutput = (s: number): string => {
    const result = completedStages.find((r) => r.stage === s);
    if (!result || result.output == null) return "";
    if (typeof result.output === "string") return result.output;
    return JSON.stringify(result.output);
  };

  const opts = input.promptOptions;

  // Resolve designContext: prefer moodboard (structured) over raw designContext string
  const designContextStage1 = input.moodboard
    ? buildMoodboardPrompt(input.moodboard, 1)
    : input.designContext;
  const designContextStage3 = input.moodboard
    ? buildMoodboardPrompt(input.moodboard, 3)
    : input.designContext;

  switch (stage) {
    case 1:
      return buildProblemStatementPrompt(
        input.title,
        input.description,
        input.projectContext,
        input.role,
        opts,
        designContextStage1,
        input.projectCtx,
      );
    case 2:
      return buildAcceptanceCriteriaPrompt(input.title, findOutput(1) || input.description, opts);
    case 3:
      return buildConstraintPrompt(input.title, findOutput(1) || input.description, findOutput(2), opts, designContextStage3, input.projectCtx);
    case 4:
      return buildDecompositionPrompt(
        input.title,
        findOutput(1) || input.description,
        findOutput(2),
        findOutput(3),
        opts,
      );
    case 5:
      return buildEvaluationDesignPrompt(
        input.title,
        findOutput(1) || input.description,
        findOutput(2),
        findOutput(3),
        opts,
      );
    default:
      throw new Error(`Unknown stage: ${stage}`);
  }
}

function buildSpecScoreInput(
  input: RefineInput,
  completedStages: StageResult[],
): SpecScoreInput {
  const hasStage = (s: number): boolean =>
    completedStages.some((r) => r.stage === s);

  const refinedDesc = completedStages.find((r) => r.stage === 1);
  const descText = refinedDesc && typeof refinedDesc.output === "string"
    ? refinedDesc.output
    : input.description;

  // A complete pipeline run (all 5 stages with output) produces a fully
  // executable spec — guardrails and role are injected into prompts during
  // refinement, so their presence in the input is not required for a 5/5.
  const allFiveComplete =
    hasStage(1) && hasStage(2) && hasStage(3) && hasStage(4) && hasStage(5);

  return {
    hasDescription: descText.length > 0,
    descriptionLength: descText.length,
    wasRefined: hasStage(1),
    hasAcceptanceCriteria: hasStage(2),
    hasGuardrails: allFiveComplete || (input.guardrails ?? []).length > 0,
    hasRole: allFiveComplete || (input.role ?? "").length > 0,
    hasScenarios: hasStage(5),
    hasSubtasks: hasStage(4),
  };
}

// ── Main export ────────────────────────────────────────────────────────

export async function refinePipeline(
  input: RefineInput,
  options: RefineOptions = {},
): Promise<RefineResult> {
  const mode = detectExecutionMode(options);
  const model = options.model ?? "claude-sonnet-4-6";
  const stagesToRun: number[] = options.stages
    ? [...options.stages].sort((a, b) => a - b)
    : [1, 2, 3, 4, 5];

  const completedStages: StageResult[] = [];

  for (const stage of stagesToRun) {
    const prompt = buildPromptForStage(stage, input, completedStages);

    let rawResponse: string;
    try {
      rawResponse = await executePrompt(prompt, mode, model, options.apiKey);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Stage ${stage} failed: ${message}`);
    }

    // DEBUG: Write raw AI response for diagnosis (temporary — remove after fix is verified)
    try {
      mkdirSync(".stoa", { recursive: true });
      writeFileSync(`.stoa/debug-stage-${stage}.txt`, rawResponse, "utf-8");
    } catch {
      // Non-critical — ignore debug write failures
    }

    let output: unknown = null;
    if (mode !== "clipboard") {
      const parser = STAGE_PARSERS[stage];
      if (parser) {
        output = parser(rawResponse);
      }
    }

    const specScoreInput = mode === "clipboard"
      ? { hasDescription: false, descriptionLength: 0, wasRefined: false, hasAcceptanceCriteria: false, hasGuardrails: false, hasRole: false, hasScenarios: false, hasSubtasks: false }
      : buildSpecScoreInput(input, [...completedStages, { stage, output, specScore: 0, rawResponse }]);

    const specScore = mode === "clipboard" ? 0 : computeSpecScore(specScoreInput).score;

    const stageResult: StageResult = {
      stage,
      output,
      specScore,
      rawResponse,
    };

    completedStages.push(stageResult);
    options.onStageComplete?.(stage, stageResult);
  }

  const lastStage = completedStages[completedStages.length - 1];

  return {
    stages: completedStages,
    finalSpecScore: lastStage?.specScore ?? 0,
    finalOutput: lastStage?.output ?? null,
    executionMode: mode,
  };
}
