/**
 * Scenario Refine Pipeline.
 * Runs a 3-stage refinement pipeline that transforms raw scenario hints from
 * a spec into structured, validated scenario definitions.
 *
 * Stage 1 — Structure: Normalize scenario hints into canonical { given, expected } format.
 * Stage 2 — Edge Cases: Print advisory edge-case suggestions to stdout (no file writes).
 * Stage 3 — Validation Commands: Attach a shell snippet to each scenario for verification.
 */

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SPAWN_TIMEOUT_MS = 300_000;

// ── Types ────────────────────────────────────────────────────────────

interface SpecScenarioHint {
  title?: string;
  given?: string;
  expected?: string;
  [key: string]: unknown;
}

interface StructuredScenario {
  given: string;
  expected: string;
}

interface FinalScenario {
  given: string;
  expected: string;
  validationCommand: string;
}

interface SpecJson {
  title?: string;
  description?: string;
  scenarios?: SpecScenarioHint[];
  [key: string]: unknown;
}

// ── Stage labels ─────────────────────────────────────────────────────

const STAGE_LABELS = [
  "Stage 1: Structure",
  "Stage 2: Edge Cases",
  "Stage 3: Validation Commands",
] as const;

// ── Pure prompt builders ─────────────────────────────────────────────

/**
 * Build the Stage 1 prompt: Structure.
 * Transforms raw scenario hints into canonical { given, expected } format.
 * @param scenarioHints - JSON string of raw scenario hints from the spec.
 * @param specTitle - The task/spec title for context.
 * @returns The full prompt string for Stage 1.
 */
export function buildStructurePrompt(scenarioHints: string, specTitle: string): string {
  return [
    "You are a QA engineer specializing in test scenario design.",
    "",
    "Given the following raw scenario hints from a task specification,",
    "normalize each one into a structured JSON array of objects with exactly two fields:",
    '- "given": A clear description of the initial condition or setup.',
    '- "expected": A clear description of the expected outcome or behavior.',
    "",
    "Rules:",
    "- Preserve the original intent of each scenario.",
    "- If a hint has a title but no given/expected split, infer them from the title.",
    "- If a hint is vague, make it concrete and testable.",
    "- Output ONLY a valid JSON array — no preamble, no commentary.",
    "",
    `Task: ${specTitle}`,
    "",
    "Scenario hints:",
    scenarioHints,
  ].join("\n");
}

/**
 * Build the Stage 2 prompt: Edge Cases.
 * Generates advisory edge-case suggestions based on structured scenarios.
 * @param structuredScenarios - JSON string of structured scenarios from Stage 1.
 * @param specTitle - The task/spec title for context.
 * @returns The full prompt string for Stage 2.
 */
export function buildEdgeCasesPrompt(structuredScenarios: string, specTitle: string): string {
  return [
    "You are a QA engineer specializing in edge-case discovery.",
    "",
    "Given the following structured test scenarios for a task,",
    "suggest additional edge cases that are NOT already covered.",
    "",
    "Rules:",
    "- Output a plain numbered list of edge-case descriptions.",
    "- Each item should be a single sentence describing the edge case.",
    "- Focus on boundary conditions, error paths, and unusual inputs.",
    "- Do NOT output JSON — just a numbered list.",
    "- Do NOT repeat scenarios already covered.",
    "",
    `Task: ${specTitle}`,
    "",
    "Existing scenarios:",
    structuredScenarios,
  ].join("\n");
}

/**
 * Build the Stage 3 prompt: Validation Commands.
 * Generates a shell command for each scenario to validate expected outcomes.
 * @param structuredScenarios - JSON string of structured scenarios from Stage 1.
 * @param specTitle - The task/spec title for context.
 * @returns The full prompt string for Stage 3.
 */
export function buildValidationCommandPrompt(structuredScenarios: string, specTitle: string): string {
  return [
    "You are a DevOps engineer writing validation scripts.",
    "",
    "Given the following structured test scenarios for a task,",
    "generate a single bash command (or short pipeline) for each scenario",
    "that can be run to validate whether the expected outcome holds.",
    "",
    "Rules:",
    "- Output a valid JSON array of objects, one per scenario, in the same order as the input.",
    '- Each object must have: "given", "expected", "validationCommand".',
    '- "validationCommand" is a single bash string that tests the expected behavior.',
    "- Commands should be self-contained and runnable from the project root.",
    "- Use common CLI tools (grep, jq, curl, test, diff, etc.).",
    "- Output ONLY a valid JSON array — no preamble, no commentary.",
    "",
    `Task: ${specTitle}`,
    "",
    "Scenarios:",
    structuredScenarios,
  ].join("\n");
}

// ── Execution helper ─────────────────────────────────────────────────

async function executeStage(
  prompt: string,
  mode: "api" | "cli",
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

  // cli mode — pipe prompt via stdin (the -p flag hangs as subprocess)
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

// ── JSON extraction helper ───────────────────────────────────────────

function extractFirstJsonArray(raw: string): unknown[] | null {
  const start = raw.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "[") depth++;
    else if (raw[i] === "]") depth--;
    if (depth === 0) {
      try {
        const parsed = JSON.parse(raw.slice(start, i + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return null;
      }
      return null;
    }
  }
  return null;
}

// ── Pipeline ─────────────────────────────────────────────────────────

/**
 * Run the 3-stage scenario refinement pipeline.
 *
 * 1. Reads `.stoa/specs/<taskName>.json` for scenario hints.
 * 2. Stage 1: Structure — normalizes hints into { given, expected }.
 * 3. Stage 2: Edge Cases — prints advisory suggestions to stdout.
 * 4. Stage 3: Validation Commands — attaches a bash snippet to each scenario.
 * 5. Writes final output to `.stoa/scenarios/<taskName>.json` (api/cli mode only).
 *
 * @param taskName - The task name (matches the spec filename without extension).
 * @param mode - Execution mode: "api", "clipboard", or "cli".
 */
export async function generateScenarios(
  taskName: string,
  mode: "api" | "clipboard" | "cli",
): Promise<void> {
  const baseDir = process.cwd();
  const specPath = join(baseDir, ".stoa", "specs", `${taskName}.json`);

  if (!existsSync(specPath)) {
    process.stderr.write(`Error: Spec file not found: .stoa/specs/${taskName}.json\n`);
    process.exit(1);
  }

  const specRaw = readFileSync(specPath, "utf-8");
  const spec: SpecJson = JSON.parse(specRaw);

  // Extract scenario hints — look for scenarios field from Stage 5 output
  const scenarioHints: SpecScenarioHint[] = spec.scenarios ?? [];
  const specTitle = spec.title ?? taskName;

  if (scenarioHints.length === 0) {
    process.stderr.write(
      `Warning: No scenario hints found in spec. The pipeline will generate from the spec context.\n`,
    );
  }

  const hintsJson = JSON.stringify(scenarioHints, null, 2);

  // ── Clipboard mode ──────────────────────────────────────────────
  if (mode === "clipboard") {
    const prompts = [
      { label: STAGE_LABELS[0], prompt: buildStructurePrompt(hintsJson, specTitle) },
      { label: STAGE_LABELS[1], prompt: buildEdgeCasesPrompt(hintsJson, specTitle) },
      { label: STAGE_LABELS[2], prompt: buildValidationCommandPrompt(hintsJson, specTitle) },
    ];

    for (const { label, prompt } of prompts) {
      const line = "─".repeat(40);
      process.stdout.write(`\n${line}\n`);
      process.stdout.write(`${label}\n`);
      process.stdout.write(`${line}\n`);
      process.stdout.write(`${prompt}\n`);
    }

    // Copy last prompt to clipboard
    try {
      const { execFileSync } = await import("node:child_process");
      const allPrompts = prompts.map((p) => `--- ${p.label} ---\n${p.prompt}`).join("\n\n");
      execFileSync("pbcopy", { input: allPrompts });
      process.stdout.write(`\nPrompts copied to clipboard.\n`);
    } catch {
      // Clipboard copy failed silently — prompts are already on stdout
    }

    return;
  }

  // ── API or CLI mode ─────────────────────────────────────────────
  const model = "claude-sonnet-4-6";
  const execMode = mode === "cli" ? "cli" : "api";

  // Stage 1: Structure
  process.stderr.write(`${STAGE_LABELS[0]}...\n`);
  const stage1Prompt = buildStructurePrompt(hintsJson, specTitle);
  const stage1Raw = await executeStage(stage1Prompt, execMode, model);
  const stage1Parsed = extractFirstJsonArray(stage1Raw);

  const structured: StructuredScenario[] = [];
  if (stage1Parsed) {
    for (const item of stage1Parsed) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.given === "string" && typeof obj.expected === "string") {
        structured.push({ given: obj.given, expected: obj.expected });
      }
    }
  }

  if (structured.length === 0) {
    process.stderr.write("Error: Stage 1 produced no valid structured scenarios.\n");
    process.exit(1);
  }

  process.stderr.write(`  → ${structured.length} scenarios structured.\n`);

  // Stage 2: Edge Cases (advisory only — print to stdout, no writes)
  process.stderr.write(`${STAGE_LABELS[1]}...\n`);
  const structuredJson = JSON.stringify(structured, null, 2);
  const stage2Prompt = buildEdgeCasesPrompt(structuredJson, specTitle);
  const stage2Raw = await executeStage(stage2Prompt, execMode, model);

  const line = "─".repeat(40);
  process.stdout.write(`\n${line}\n`);
  process.stdout.write(`Suggested Edge Cases (advisory only):\n`);
  process.stdout.write(`${line}\n`);
  process.stdout.write(`${stage2Raw}\n`);

  // Stage 3: Validation Commands
  process.stderr.write(`${STAGE_LABELS[2]}...\n`);
  const stage3Prompt = buildValidationCommandPrompt(structuredJson, specTitle);
  const stage3Raw = await executeStage(stage3Prompt, execMode, model);
  const stage3Parsed = extractFirstJsonArray(stage3Raw);

  const finalScenarios: FinalScenario[] = [];
  if (stage3Parsed) {
    for (let i = 0; i < stage3Parsed.length; i++) {
      const obj = stage3Parsed[i] as Record<string, unknown>;
      const base = structured[i] ?? { given: "", expected: "" };
      finalScenarios.push({
        given: typeof obj.given === "string" ? obj.given : base.given,
        expected: typeof obj.expected === "string" ? obj.expected : base.expected,
        validationCommand: typeof obj.validationCommand === "string" ? obj.validationCommand : "",
      });
    }
  } else {
    // Fallback: use structured scenarios with empty validation commands
    for (const s of structured) {
      finalScenarios.push({ ...s, validationCommand: "" });
    }
  }

  // Write output
  const outPath = join(baseDir, ".stoa", "scenarios", `${taskName}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(finalScenarios, null, 2) + "\n", "utf-8");

  process.stderr.write(`\nWritten: .stoa/scenarios/${taskName}.json (${finalScenarios.length} scenarios)\n`);
}
