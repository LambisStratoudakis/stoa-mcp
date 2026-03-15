/**
 * Role Refine Pipeline.
 * Runs a 3-stage refinement pipeline that transforms raw role definitions
 * into precise, bounded, guardrail-ready specifications.
 *
 * Stage 1 — Sharpen Identity: Rewrite the role persona to be specific and unambiguous.
 * Stage 2 — Define Boundaries: Generate explicit boundary rules (file scope, tech limits, escalation).
 * Stage 3 — Suggest Guardrails: Print 2–4 guardrail suggestions to stdout only (no file writes).
 */

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 300_000;

function rolesDir(): string {
  return join(process.cwd(), ".stoa", "roles");
}

// ── Stage names ──────────────────────────────────────────────────────

const STAGE_LABELS = [
  "Stage 1: Sharpen Identity",
  "Stage 2: Define Boundaries",
  "Stage 3: Suggest Guardrails",
] as const;

// ── Pure prompt builders ─────────────────────────────────────────────

/**
 * Build the Stage 1 prompt: Sharpen Identity.
 * Rewrites the role persona to be specific, unambiguous, and self-contained.
 * @param seed - The raw role markdown content.
 * @returns The full prompt string for Stage 1.
 */
export function buildStage1Prompt(seed: string): string {
  return [
    "You are a technical writing editor specializing in agent role definitions for software engineering teams.",
    "",
    "Rewrite the following role definition so it is specific, unambiguous, and self-contained.",
    "The output must make it clear:",
    "- What the role does (primary responsibilities)",
    "- What its primary decisions are (what it chooses, prioritizes, or trades off)",
    "- What communication style it uses (tone, verbosity, formality)",
    "",
    "Remove vague language. Replace subjective terms with concrete descriptions.",
    "Preserve the original intent and any technical details.",
    "Output only the rewritten role definition in markdown format — no preamble, no commentary.",
    "Keep the original heading (# line) intact.",
    "",
    "---",
    "",
    seed,
  ].join("\n");
}

/**
 * Build the Stage 2 prompt: Define Boundaries.
 * Generates explicit boundary rules covering file scope, technology limits, and escalation triggers.
 * @param stage1Output - The sharpened role definition from Stage 1.
 * @returns The full prompt string for Stage 2.
 */
export function buildStage2Prompt(stage1Output: string): string {
  return [
    "You are a technical writing editor specializing in agent role definitions for software engineering teams.",
    "",
    "The following is a sharpened role definition. Append a `## Boundaries` section at the end.",
    "The section must cover three areas:",
    "",
    "1. **File Scope** — Which directories and file types the role is authorized to read or modify.",
    "   Use advisory language (e.g. \"Focus on: [...]\", \"Avoid: [...]\").",
    "",
    "2. **Technology Limits** — Specific libraries, languages, frameworks, or APIs the role should and should not use.",
    "",
    "3. **Escalation Triggers** — Conditions under which the role should pause and ask for human input",
    "   rather than proceed autonomously (e.g. breaking changes, security-sensitive operations, ambiguous requirements).",
    "",
    "Each sub-area should be a subsection (### heading) within ## Boundaries.",
    "Be specific and actionable — no vague advice.",
    "Output the complete role definition with the new section appended — no preamble, no commentary.",
    "",
    "---",
    "",
    stage1Output,
  ].join("\n");
}

/**
 * Build the Stage 3 prompt: Suggest Guardrails.
 * Generates 2–4 guardrail rule suggestions based on the sharpened identity and defined boundaries.
 * @param stage2Output - The role definition with boundaries from Stage 2.
 * @returns The full prompt string for Stage 3.
 */
export function buildStage3Prompt(stage2Output: string): string {
  return [
    "You are a technical writing editor specializing in software engineering guardrails and coding standards.",
    "",
    "Given the following role definition (with identity and boundaries), suggest 2–4 guardrail rules",
    "that would make this role safer and more reliable when operating autonomously.",
    "",
    "For each guardrail:",
    "- Give it a short, descriptive title",
    "- Write 3–5 checklist items (- [ ]) that are concrete and verifiable",
    "- Include at least one BAD and one GOOD code/config example where relevant",
    "",
    "Format the output as markdown with each guardrail as a ## heading.",
    "This output is advisory — it will be shown to a human for review.",
    "Do not include any preamble or commentary outside the guardrail definitions.",
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

/** Options for the role refine pipeline. */
export interface RoleRefineOptions {
  name: string;
  mode: "clipboard" | "api" | "claude-code";
  model?: string;
  apiKey?: string;
  onStageComplete?: (stageIndex: number, label: string, output: string) => void;
}

/** Result of the role refine pipeline. */
export interface RoleRefineResult {
  prompts: string[];
  finalOutput: string;
}

/**
 * Run the 3-stage role refinement pipeline.
 *
 * - clipboard: Builds all 3 stage prompts and returns them via onStageComplete callback.
 *   Does not call any AI API. Does not modify files.
 * - api: Executes all 3 stages via Anthropic API. Writes stage 1+2 output to file.
 *   Stage 3 output is returned but not written.
 * - claude-code: Executes via Claude Code CLI. Writes stage 1+2 output to file.
 *   Stage 3 output is returned but not written.
 *
 * @param options - Pipeline configuration including name, mode, and optional model/apiKey.
 * @returns The prompts used and the final output.
 * @throws If the role file does not exist.
 */
export async function refinePipeline(
  options: RoleRefineOptions,
): Promise<RoleRefineResult> {
  const filePath = join(rolesDir(), `${options.name}.md`);

  if (!existsSync(filePath)) {
    throw new Error(
      `Role not found: .stoa/roles/${options.name}.md`,
    );
  }

  const seed = readFileSync(filePath, "utf-8");
  const model = options.model ?? "claude-sonnet-4-6";
  const builders = [buildStage1Prompt, buildStage2Prompt, buildStage3Prompt];

  const prompts: string[] = [];

  if (options.mode === "clipboard") {
    // Clipboard mode: build prompts sequentially, no AI calls, no file writes
    let currentInput = seed;
    for (let i = 0; i < builders.length; i++) {
      const prompt = builders[i](currentInput);
      prompts.push(prompt);
      options.onStageComplete?.(i, STAGE_LABELS[i], prompt);
      // In clipboard mode, the "output" of each stage is the prompt itself
      // (user will paste it manually). Chain the seed forward unchanged.
      currentInput = prompt;
    }
    return { prompts, finalOutput: "" };
  }

  // api or claude-code mode
  let currentInput = seed;
  for (let i = 0; i < builders.length; i++) {
    const prompt = builders[i](currentInput);
    prompts.push(prompt);

    currentInput = await executeStage(
      prompt,
      options.mode,
      model,
      options.apiKey,
    );

    options.onStageComplete?.(i, STAGE_LABELS[i], currentInput);

    // After stage 2, write the result back to the role file (stages 1+2 combined)
    if (i === 1) {
      writeFileSync(filePath, currentInput, "utf-8");
    }
  }

  // Stage 3 output is NOT written to any file — it's advisory only
  return { prompts, finalOutput: currentInput };
}
