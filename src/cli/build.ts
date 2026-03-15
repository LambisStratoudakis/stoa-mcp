import { existsSync, readFileSync, mkdirSync, createWriteStream, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { loadAllGuardrails } from "../guardrails/loader.js";
import { loadRole } from "../storage/roles.js";

export interface ComposePromptOpts {
  role: string;
}

/**
 * Read an approved spec file and extract Stage 1 + Stage 3 content.
 * Exits non-zero if the file is missing or either stage is absent.
 */
export function readApprovedSpec(name: string): { stage1: string; stage3: string } {
  const specDir = join(process.cwd(), ".stoa", "specs", name);
  const descPath = join(specDir, "01-problem-statement.md");
  const constraintsPath = join(specDir, "03-constraints.md");

  if (!existsSync(descPath)) {
    process.stderr.write(`Error: Spec description not found: ${descPath}\n`);
    process.exit(1);
  }

  if (!existsSync(constraintsPath)) {
    process.stderr.write(`Error: Spec constraints not found: ${constraintsPath}\n`);
    process.exit(1);
  }

  const stage1 = readFileSync(descPath, "utf-8").trim();
  const stage3 = readFileSync(constraintsPath, "utf-8").trim();

  if (stage1.length === 0) {
    process.stderr.write(`Error: Stage 1 (Problem Statement) is empty in ${descPath}\n`);
    process.exit(1);
  }

  if (stage3.length === 0) {
    process.stderr.write(`Error: Stage 3 (Constraints) is empty in ${constraintsPath}\n`);
    process.exit(1);
  }

  return { stage1, stage3 };
}

/**
 * Extract a stage section from the approved spec markdown.
 * Matches `## Stage N:` headers and captures content until the next `## Stage` header or EOF.
 */
function extractSection(content: string, stageNum: number): string | null {
  const pattern = new RegExp(
    `^## Stage ${stageNum}:[^\\n]*\\n([\\s\\S]*?)(?=^## Stage \\d|$)`,
    "m",
  );
  const match = pattern.exec(content);
  if (!match) return null;
  const text = match[1].trim();
  return text.length > 0 ? text : null;
}

/**
 * Compose a full build prompt from an approved spec, role, guardrails, and moodboard.
 * Does NOT include scenario content.
 */
export function composePrompt(name: string, opts: ComposePromptOpts): string {
  const { stage1, stage3 } = readApprovedSpec(name);

  const roleText = loadRole(opts.role);
  const guardrailsText = loadAllGuardrails();

  const parts: string[] = [];

  // Role persona
  parts.push("# Role\n");
  parts.push(roleText);

  // Stage 1: Problem Statement
  parts.push("\n\n# Task\n");
  parts.push(stage1);

  // Stage 3: Constraints
  parts.push("\n\n# Constraints\n");
  parts.push(stage3);

  // Guardrails
  if (guardrailsText.length > 0) {
    parts.push("\n\n# Guardrails\n");
    parts.push(guardrailsText);
  }

  // Moodboard reference
  const moodboardPath = join(process.cwd(), ".stoa", "moodboard", "notes.md");
  if (existsSync(moodboardPath)) {
    const moodboardText = readFileSync(moodboardPath, "utf-8").trim();
    if (moodboardText.length > 0) {
      parts.push("\n\n# Moodboard\n");
      parts.push(moodboardText);
    }
  }

  return parts.join("");
}

const ALLOWED_TOOLS = "Edit,Write,Read,Glob,Grep,LSP";
const OVERALL_TIMEOUT_MS = 600_000;

/**
 * Spawn Claude Code in Edit Files mode with the build prompt.
 * Streams output to both terminal and a session log file in `.stoa/sessions/`.
 * Uses --allowedTools so Claude Code can create/edit files (not --print).
 * Completes when the close event fires (Claude Code exits normally in Edit Files mode).
 */
export function runBuild(name: string, prompt: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const startTime = Date.now();

    // Ensure sessions directory exists
    const sessionsDir = join(process.cwd(), ".stoa", "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    // Session file: <name>-<ISO8601>.md
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sessionFile = `${name}-${timestamp}.md`;
    const sessionPath = join(sessionsDir, sessionFile);

    // Write session header
    const logStream = createWriteStream(sessionPath, { flags: "a" });
    logStream.write(`# Build Session: ${name}\n`);
    logStream.write(`- Timestamp: ${new Date().toISOString()}\n`);
    logStream.write(`- Spec: ${name}\n`);
    logStream.write(`- Mode: claude-code (Edit Files)\n\n---\n\n`);

    const child = spawn("claude", [
      "--output-format", "text",
      "--allowedTools", ALLOWED_TOOLS,
    ], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    let resolved = false;

    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(overallTimer);
      process.removeListener("SIGINT", onParentSigint);
      child.kill();

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      logStream.write(`\n\n---\nDuration: ${durationSec}s\n`);
      logStream.end();

      process.stdout.write("\n");
      process.stdout.write(chalk.green(`Build complete in ${durationSec}s\n`));
      process.stdout.write(chalk.dim(`Session saved: ${sessionPath}\n`));

      // Post-build: scan for package.json files needing npm install
      postBuildInstall();

      // Detect start command
      postBuildStartHint();

      process.stdout.write(chalk.cyan(`Run ${chalk.white("stoa verify")} to check blind test scenarios.\n`));
      resolve();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    child.on("close", () => {
      finish();
    });

    const overallTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        process.removeListener("SIGINT", onParentSigint);
        child.kill("SIGKILL");
        logStream.end();
        reject(new Error(`Claude Code subprocess timed out after ${OVERALL_TIMEOUT_MS / 1000}s`));
      }
    }, OVERALL_TIMEOUT_MS);

    const onParentSigint = (): void => {
      child.kill("SIGINT");
    };
    process.once("SIGINT", onParentSigint);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(overallTimer);
        process.removeListener("SIGINT", onParentSigint);
        logStream.end();

        if (err.code === "ENOENT") {
          process.stderr.write(
            chalk.red("\nError: Claude Code CLI not found.\n") +
            chalk.dim("Install: https://docs.anthropic.com/en/docs/claude-code\n") +
            chalk.dim("Or use `stoa export " + name + "` to copy the prompt to clipboard.\n"),
          );
        }
        reject(err);
      }
    });

    // Write prompt to stdin and close
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Scan for package.json files (max 3 levels deep) that lack node_modules/.
 * Auto-run npm install for each.
 */
function postBuildInstall(): void {
  const cwd = process.cwd();
  const found = findPackageJsons(cwd, 0, 3);

  for (const dir of found) {
    const nodeModulesPath = join(dir, "node_modules");
    if (!existsSync(nodeModulesPath)) {
      const relDir = relative(cwd, dir) || ".";
      process.stdout.write(chalk.dim(`Installing dependencies in ./${relDir}...\n`));
      try {
        const child = spawn("npm", ["install"], {
          cwd: dir,
          stdio: "inherit",
          shell: false,
        });
        // Fire-and-forget — don't block on npm install
        child.unref();
      } catch {
        // Non-critical — continue
      }
    }
  }
}

/**
 * Recursively find directories containing package.json, up to maxDepth levels.
 */
function findPackageJsons(dir: string, depth: number, maxDepth: number): string[] {
  const results: string[] = [];
  if (depth > maxDepth) return results;

  if (existsSync(join(dir, "package.json"))) {
    results.push(dir);
  }

  if (depth < maxDepth) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          results.push(...findPackageJsons(join(dir, entry.name), depth + 1, maxDepth));
        }
      }
    } catch {
      // Permission error or similar — skip
    }
  }

  return results;
}

/**
 * Check for dev or start script in package.json and print a hint.
 */
function postBuildStartHint(): void {
  const pkgPath = join(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) return;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts ?? {};
    if (scripts.dev) {
      process.stdout.write(chalk.dim(`To start the app: ${chalk.white("npm run dev")}\n`));
    } else if (scripts.start) {
      process.stdout.write(chalk.dim(`To start the app: ${chalk.white("npm start")}\n`));
    }
  } catch {
    // ignore malformed package.json
  }
}

export interface Subtask {
  index: number;
  text: string;
}

/**
 * Parse a `## Subtasks` section from spec content.
 * Extracts numbered items (e.g. "1. Do something").
 * Returns empty array if no Subtasks section exists.
 */
export function parseSubtasks(specContent: string): Subtask[] {
  const pattern = /^## Subtasks\s*\n([\s\S]*?)(?=\n## )/m;
  const match = pattern.exec(specContent);
  // If no next ## heading, try matching to end of string
  const endPattern = /^## Subtasks\s*\n([\s\S]*)$/m;
  const result = match ?? endPattern.exec(specContent);
  if (!result) return [];

  const body = result[1];
  const subtasks: Subtask[] = [];
  const itemPattern = /^(\d+)\.\s+(.+(?:\n(?!\d+\.).*)*)/gm;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemPattern.exec(body)) !== null) {
    subtasks.push({
      index: parseInt(itemMatch[1], 10),
      text: itemMatch[2].trim(),
    });
  }

  return subtasks;
}

/**
 * Prompt user to choose subtask execution mode.
 * Returns "all", "q", or a 1-based subtask number.
 */
export function promptSubtaskChoice(subtasks: Subtask[]): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      chalk.cyan(`Build all sequentially or pick one? [all/1-${subtasks.length}/q] `),
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase());
      },
    );
  });
}
