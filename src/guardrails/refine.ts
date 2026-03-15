/**
 * Guardrail Refine Pipeline.
 * Runs a 3-stage refinement pipeline that transforms raw guardrail rules
 * into precise, verifiable, example-backed specifications.
 */

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 300_000;

function guardrailsDir(): string {
  return join(process.cwd(), ".stoa", "guardrails");
}

// ── Stage names ──────────────────────────────────────────────────────

const STAGE_LABELS = [
  "Stage 1: Clarify & Tighten",
  "Stage 2: Add Verification (How to Check)",
  "Stage 3: Add Examples (Good/Bad)",
] as const;

// ── Pure prompt builders ─────────────────────────────────────────────

/**
 * Build the Stage 1 prompt: Clarify & Tighten.
 * Rewrites the guardrail rule to be unambiguous, specific, and actionable.
 * Removes vague language while preserving original intent.
 * @param seed - The raw guardrail markdown content.
 * @returns The full prompt string for Stage 1.
 */
export function buildStage1Prompt(seed: string): string {
  return [
    "You are a technical writing editor specializing in software engineering guardrails and coding standards.",
    "",
    "Rewrite the following guardrail rule so it is unambiguous, specific, and actionable.",
    "Remove vague language like \"should\", \"try to\", \"generally\", \"where possible\".",
    "Replace subjective terms with objective, measurable criteria.",
    "Preserve the original intent and all technical details.",
    "Output only the rewritten guardrail in markdown format — no preamble, no commentary.",
    "",
    "---",
    "",
    seed,
  ].join("\n");
}

/**
 * Build the Stage 2 prompt: Add Verification (How to Check).
 * Appends a "How to Check" section with concrete, mechanical verification steps.
 * @param stage1Output - The clarified guardrail text from Stage 1.
 * @returns The full prompt string for Stage 2.
 */
export function buildStage2Prompt(stage1Output: string): string {
  return [
    "You are a technical writing editor specializing in software engineering guardrails and coding standards.",
    "",
    "The following is a refined guardrail rule. Append a \"## How to Check\" section at the end.",
    "The section must describe concrete, mechanical ways to verify the rule is being followed.",
    "Include specific grep patterns, lint rules, code review checkpoints, or CI checks as appropriate.",
    "Each verification step must be a checklist item (- [ ]) that a reviewer can mark off.",
    "Output the complete guardrail with the new section appended — no preamble, no commentary.",
    "",
    "---",
    "",
    stage1Output,
  ].join("\n");
}

/**
 * Build the Stage 3 prompt: Add Examples (Good/Bad).
 * Appends Good Example and Bad Example sections with inline code snippets.
 * @param stage2Output - The guardrail text with verification from Stage 2.
 * @returns The full prompt string for Stage 3.
 */
export function buildStage3Prompt(stage2Output: string): string {
  return [
    "You are a technical writing editor specializing in software engineering guardrails and coding standards.",
    "",
    "The following is a refined guardrail rule with verification steps.",
    "Append a \"## Good Example\" section and a \"## Bad Example\" section at the end.",
    "Each section must contain inline code snippets (using fenced code blocks) that illustrate",
    "compliance and violation of the rule respectively.",
    "Include brief comments in the code explaining why each example is good or bad.",
    "Output the complete guardrail with both new sections appended — no preamble, no commentary.",
    "",
    "---",
    "",
    stage2Output,
  ].join("\n");
}

// ── Execution helpers ────────────────────────────────────────────────

async function executeStage(
  prompt: string,
  mode: "api" | "claude-code",
  model: string,
  apiKey?: string,
): Promise<string> {
  if (mode === "api") {
    const client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock ? textBlock.text : "";
  }

  // claude-code mode — pipe prompt via stdin (the -p flag hangs as subprocess)
  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["--print"], {
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
      child.kill();
      resolve(stdout.trim());
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
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
        child.kill("SIGKILL");
        reject(new Error(`Claude Code timed out after ${SPAWN_TIMEOUT_MS / 1000}s`));
      }
    }, SPAWN_TIMEOUT_MS);

    child.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(overallTimer);
        if (dataTimer) clearTimeout(dataTimer);
        reject(err);
      }
    });

    // Write prompt to stdin and close it
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ── Pipeline ─────────────────────────────────────────────────────────

/** Options for the guardrail refine pipeline. */
export interface GuardrailRefineOptions {
  name: string;
  mode: "clipboard" | "api" | "claude-code";
  model?: string;
  apiKey?: string;
  onStageComplete?: (stageIndex: number, label: string, output: string) => void;
}

/** Result of the guardrail refine pipeline. */
export interface GuardrailRefineResult {
  prompts: string[];
  finalOutput: string;
}

/**
 * Run the 3-stage guardrail refinement pipeline.
 *
 * - clipboard: Executes all 3 stages via Anthropic API with chained outputs. Does not modify files.
 * - api: Executes all 3 stages via Anthropic API. Writes final output to file.
 * - claude-code: Executes via Claude Code CLI. Writes final output to file.
 *
 * @param options - Pipeline configuration including name, mode, and optional model/apiKey.
 * @returns The prompts used and the final output.
 * @throws If the guardrail file does not exist.
 */
export async function refinePipeline(
  options: GuardrailRefineOptions,
): Promise<GuardrailRefineResult> {
  const filePath = join(guardrailsDir(), `${options.name}.md`);

  if (!existsSync(filePath)) {
    throw new Error(
      `Guardrail not found: .stoa/guardrails/${options.name}.md`,
    );
  }

  const seed = readFileSync(filePath, "utf-8");
  const model = options.model ?? "claude-sonnet-4-6";
  const builders = [buildStage1Prompt, buildStage2Prompt, buildStage3Prompt];

  const executeMode = options.mode === "clipboard" ? "api" : options.mode;
  const prompts: string[] = [];
  let currentInput = seed;

  for (let i = 0; i < builders.length; i++) {
    const prompt = builders[i](currentInput);
    prompts.push(prompt);

    currentInput = await executeStage(
      prompt,
      executeMode,
      model,
      options.apiKey,
    );

    options.onStageComplete?.(i, STAGE_LABELS[i], currentInput);
  }

  // Only write back to file for api/claude-code modes
  if (options.mode !== "clipboard") {
    writeFileSync(filePath, currentInput, "utf-8");
  }

  return { prompts, finalOutput: currentInput };
}
