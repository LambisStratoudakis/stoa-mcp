#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { basename, join, extname } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, readdirSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";

import { refinePipeline } from "./core/refine.js";
import { computeSpecScore } from "./core/spec-score.js";
import type { StageResult } from "./core/refine.js";
import { initProject, loadConfig } from "./storage/project.js";
import type { PromptOptions } from "./core/prompts.js";
import {
  listGuardrails,
  addGuardrail,
  showGuardrail,
  removeGuardrail,
  loadAllGuardrails,
} from "./guardrails/loader.js";
import { refinePipeline as refineGuardrail } from "./guardrails/refine.js";
import { refinePipeline as refineRole } from "./storage/roles-refine.js";
import { toSlug, resolveSlug } from "./utils/slug.js";
import { readMoodboard, writeSpecFiles, writeRefineMeta, listSpecs, showSpec, STAGE_FILENAMES } from "./storage/index.js";
import {
  listRoles,
  addRole,
  showRole,
  removeRole,
  loadRole,
} from "./storage/roles.js";
import {
  listScenarios,
  showScenarios,
  addScenario,
  removeScenario,
} from "./storage/scenarios.js";
import { generateScenarios } from "./storage/scenarios-refine.js";
import { resolveSpecName, snapshotSpecFiles, validateSpecName } from "./utils/spec-helpers.js";
import { runReviewLoop } from "./cli/review-loop.js";
import { composePrompt, runBuild, parseSubtasks, promptSubtaskChoice } from "./cli/build.js";
import { runVerify } from "./cli/verify.js";
import { detectChanges } from "./storage/change-detection.js";
import { promptAndRerun } from "./tools/rerefine.js";
import { scanProject } from "./storage/project-scan.js";
import { syncMoodboard } from "./storage/moodboard-sync.js";
import { describeMoodboard } from "./storage/moodboard-describe.js";
import { runSpecScenarios, loadSpecScenarios } from "./cli/scenarios-runner.js";
import { spawn, execFileSync } from "node:child_process";
import { listPresets, loadPreset, applyPreset, savePreset } from "./storage/moodboard-presets.js";
import { pickPreset } from "./cli/moodboard-picker.js";
import { runMoodboardEdit } from "./cli/moodboard-edit.js";

// ── Constants ─────────────────────────────────────────────────────────

const STAGE_NAMES = ["clarify", "structure", "score", "harden", "finalize"] as const;

const STAGE_NAME_TO_NUMBER: Record<string, 1 | 2 | 3 | 4 | 5> = {
  clarify: 1,
  structure: 2,
  score: 3,
  harden: 4,
  finalize: 5,
};

const STAGE_DISPLAY_NAMES: Record<number, string> = {
  1: "Problem Statement",
  2: "Acceptance Criteria",
  3: "Constraints",
  4: "Decomposition",
  5: "Evaluation Design",
};

const GLOBAL_CONFIG_DIR = join(homedir(), ".stoa");
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");

// ── Helpers ───────────────────────────────────────────────────────────

function writeln(text = ""): void {
  process.stdout.write(text + "\n");
}

function colorScore(score: number): string {
  if (score >= 4) return chalk.green(`${score}`);
  if (score >= 3) return chalk.yellow(`${score}`);
  return chalk.red(`${score}`);
}

function printScoreBadge(score: number): void {
  const label = `  Spec Score: ${colorScore(score)} / 5  `;
  const rawLabel = `  Spec Score: ${score} / 5  `;
  const width = rawLabel.length;
  const top = "┌" + "─".repeat(width) + "┐";
  const bottom = "└" + "─".repeat(width) + "┘";
  writeln();
  writeln(top);
  writeln("│" + label + "│");
  writeln(bottom);
}

function printStageHeader(index: number, total: number, stage: number): void {
  const line = "─".repeat(37);
  writeln();
  writeln(line);
  writeln(
    chalk.bold(`Stage ${index} / ${total} — ${STAGE_DISPLAY_NAMES[stage] ?? `Stage ${stage}`}`),
  );
  writeln(line);
}

function formatStageOutput(output: unknown): string {
  if (output == null) return "(no output)";
  if (typeof output === "string") {
    // Detect JSON array strings (e.g. Stage 2 acceptance criteria)
    const trimmed = output.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          return parsed.map((item, i) => `${i + 1}. ${item}`).join("\n");
        }
      } catch {
        // Not valid JSON — fall through
      }
    }
    return output;
  }
  if (Array.isArray(output) && output.every((item) => typeof item === "string")) {
    return output.map((item, i) => `${i + 1}. ${item}`).join("\n");
  }
  return JSON.stringify(output, null, 2);
}

async function readConfig(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(GLOBAL_CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeConfig(config: Record<string, string>): Promise<void> {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  await writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function maskApiKey(value: string): string {
  if (value.length <= 4) return value;
  return value.slice(0, 3) + "..." + value.slice(-4);
}

function detectEditor(): string {
  // Prefer cursor → code → $EDITOR → open (macOS) → nano
  try { execFileSync("which", ["cursor"], { stdio: "ignore" }); return "cursor"; } catch { /* */ }
  try { execFileSync("which", ["code"], { stdio: "ignore" }); return "code"; } catch { /* */ }
  if (process.env.EDITOR) return process.env.EDITOR;
  if (process.platform === "darwin") return "open";
  return "nano";
}

function copyToClipboard(text: string): void {
  try {
    const child = spawn("pbcopy", { stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.write(text);
    child.stdin.end();
  } catch {
    // Clipboard unavailable — skip silently
  }
}

async function buildExportMarkdown(specsDir: string, slug: string): Promise<string> {
  const specDir = join(specsDir, slug);
  const sections: string[] = [];

  for (const stageNum of [1, 2, 3, 4, 5]) {
    const filename = STAGE_FILENAMES[stageNum];
    if (!filename) continue;
    try {
      const content = await readFile(join(specDir, filename), "utf-8");
      const displayName = STAGE_DISPLAY_NAMES[stageNum] ?? `Stage ${stageNum}`;
      sections.push(`## Stage ${stageNum}: ${displayName}\n\n${content.trimEnd()}`);
    } catch {
      // stage file missing — skip
    }
  }

  return sections.join("\n\n") + "\n";
}

function waitForKeypress(): Promise<string> {
  return new Promise((resolve) => {
    const { stdin } = process;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      resolve("q");
      return;
    }
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.once("data", (data: Buffer) => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      resolve(data.toString());
    });
  });
}

async function showPostRefineMenu(slug: string): Promise<void> {
  const specsDir = join(process.cwd(), ".stoa", "specs");
  const specDir = join(specsDir, slug);

  const printMenu = (): void => {
    writeln();
    writeln(chalk.bold("What next?"));
    writeln(`  ${chalk.cyan("[b]")} Build with Claude Code`);
    writeln(`  ${chalk.cyan("[c]")} Copy spec to clipboard`);
    writeln(`  ${chalk.cyan("[e]")} Export as single markdown`);
    writeln(`  ${chalk.cyan("[v]")} View spec files`);
    writeln(`  ${chalk.cyan("[q]")} Done`);
    writeln();
  };

  if (!process.stdin.isTTY) {
    writeln();
    writeln(chalk.bold("Next steps:"));
    writeln(`  ${chalk.cyan("stoa export")} ${slug}  — export spec as markdown`);
    writeln(`  ${chalk.cyan("stoa build")} ${slug}   — build with Claude Code`);
    writeln();
    return;
  }

  printMenu();

  while (true) {
    const key = await waitForKeypress();

    // Handle Ctrl+C
    if (key === "\x03") {
      process.exit(0);
    }

    switch (key.toLowerCase()) {
      case "b": {
        // Verify spec dir exists
        try {
          await access(specDir);
        } catch {
          writeln(chalk.red(`Error: spec directory not found: .stoa/specs/${slug}/`));
          printMenu();
          break;
        }
        const buildPrompt = `Read the spec in .stoa/specs/${slug}/ and build it. Follow all constraints and subtasks. Do not modify or delete the .stoa/ directory — it is not part of the project.`;
        spawn("claude", [buildPrompt], { stdio: "inherit", detached: true });
        return;
      }

      case "c": {
        const markdown = await buildExportMarkdown(specsDir, slug);
        copyToClipboard(markdown);
        writeln(chalk.green("Spec copied to clipboard."));
        printMenu();
        break;
      }

      case "e": {
        const markdown = await buildExportMarkdown(specsDir, slug);
        const exportDir = join(process.cwd(), "specs", slug);
        await mkdir(exportDir, { recursive: true });
        const exportPath = join(exportDir, "spec.md");
        await writeFile(exportPath, markdown, "utf-8");
        writeln(chalk.green(`Exported to specs/${slug}/spec.md`));
        printMenu();
        break;
      }

      case "v": {
        // Verify spec dir exists
        try {
          await access(specDir);
        } catch {
          writeln(chalk.red(`Error: spec directory not found: .stoa/specs/${slug}/`));
          printMenu();
          break;
        }
        const opener = process.platform === "darwin" ? "open" : "xdg-open";
        spawn(opener, [specDir], { stdio: "ignore", detached: true });
        writeln(chalk.dim(specDir));
        printMenu();
        break;
      }

      case "q": {
        process.exit(0);
      }

      default:
        // Ignore unrecognized keys
        break;
    }
  }
}

async function printPostRefineOutput(slug: string, specScore: number): Promise<void> {
  const specsDir = join(process.cwd(), ".stoa", "specs");
  const descPath = join(specsDir, slug, "01-problem-statement.md");

  // Copy Stage 1 to clipboard (preserved behavior)
  let copiedToClipboard = false;
  try {
    const descContent = await readFile(descPath, "utf-8");
    copyToClipboard(descContent);
    copiedToClipboard = true;
  } catch {
    // description file missing — skip
  }

  writeln();
  writeln(chalk.cyan(`Spec saved to .stoa/specs/${slug}/`));
  printScoreBadge(specScore);

  if (copiedToClipboard) {
    writeln();
    writeln(chalk.green("→ Stage 1 description copied to clipboard"));
    writeln(chalk.dim("  Paste into Lovable, Bolt, v0, or any AI tool"));
  }

  await showPostRefineMenu(slug);
}

function resolveStages(stagesArg: string): (1 | 2 | 3 | 4 | 5)[] {
  const names = stagesArg.split(",").map((s) => s.trim());
  return names.map((name) => {
    const num = STAGE_NAME_TO_NUMBER[name];
    if (!num) {
      const valid = STAGE_NAMES.join(", ");
      process.stderr.write(chalk.red(`Unknown stage: "${name}". Valid stages: ${valid}`) + "\n");
      process.exit(1);
    }
    return num;
  });
}

// ── Read version from package.json ────────────────────────────────────

const __pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(__pkgPath, "utf-8")) as { version: string };

// ── Program ───────────────────────────────────────────────────────────

const program = new Command();

program
  .name("stoa")
  .description("Stoa — spec refinement CLI")
  .version(pkg.version);

// ── stoa refine ───────────────────────────────────────────────────────

program
  .command("refine")
  .description("Run the spec refinement pipeline on a task description")
  .argument("<description>", "Task description to refine")
  .option("--stages <stages>", "Comma-separated stage names to run (e.g. clarify,structure)")
  .option("--role <role>", "Role context for the pipeline (e.g. 'Backend Dev')")
  .option("--mode <mode>", "Execution mode (clipboard|api|claude-code)")
  .action(async (description: string, opts: { stages?: string; role?: string; mode?: string }) => {
    const validModes = ["clipboard", "api", "claude-code"] as const;
    type Mode = (typeof validModes)[number];

    if (opts.mode && !validModes.includes(opts.mode as Mode)) {
      process.stderr.write(
        chalk.red(`Invalid mode: "${opts.mode}". Valid modes: ${validModes.join(", ")}`) + "\n",
      );
      process.exit(1);
    }

    const stageNumbers = opts.stages ? resolveStages(opts.stages) : undefined;
    const totalStages = stageNumbers ? stageNumbers.length : 5;
    let stageIndex = 0;

    // Load guardrails
    const guardrailItems = listGuardrails();
    const guardrails = guardrailItems.map((g) => g.title);

    // Resolve role
    let roleName: string | undefined = opts.role;
    if (!roleName) {
      try {
        const config = await loadConfig();
        roleName = (config as unknown as Record<string, unknown>).defaultRole as string | undefined;
      } catch (err) {
        if (err instanceof SyntaxError) {
          process.stderr.write(
            chalk.red("Error: .stoa/config.json contains invalid JSON — fix or delete the file.") + "\n",
          );
          process.exit(1);
        }
        // File not found — roleName stays undefined
      }
    }

    let roleContent: string | undefined;
    if (roleName) {
      try {
        roleContent = loadRole(toSlug(roleName));
      } catch {
        const rolePath = `.stoa/roles/${toSlug(roleName)}.md`;
        process.stderr.write(chalk.red(`Error: Role file not found: ${rolePath}`) + "\n");
        process.exit(1);
      }
    }

    // Build prompt options
    const promptOptions: PromptOptions = {
      ...(guardrails.length > 0 ? { guardrails } : {}),
      ...(roleContent ? { role: roleContent } : {}),
    };
    const hasPromptOptions = guardrails.length > 0 || roleContent;

    // Sync moodboard tokens before loading (ensures tokens.json is up to date)
    try {
      syncMoodboard(process.cwd());
    } catch {
      // Non-critical — notes.md may not exist
    }

    // Load moodboard design context (optional — continue without it on error)
    let moodboard: import("./storage/index.js").MoodboardContext | undefined;
    try {
      const result = await readMoodboard(process.cwd());
      if (result) {
        moodboard = result;
      }
    } catch {
      // Non-critical — proceed without design context
    }

    // Scan project for context (optional — continue without it on error)
    let projectCtx: import("./storage/project-scan.js").ProjectContext | undefined;
    try {
      projectCtx = scanProject(process.cwd());
    } catch {
      // Non-critical — proceed without project context
    }

    const executionMode = opts.mode as Mode | undefined;

    // In clipboard mode, skip spinner
    if (executionMode === "clipboard") {
      const stagesToRun = stageNumbers ?? [1, 2, 3, 4, 5] as (1 | 2 | 3 | 4 | 5)[];
      try {
        const result = await refinePipeline(
          {
            title: description,
            description,
            role: opts.role,
            guardrails,
            moodboard,
            projectCtx,
            promptOptions: hasPromptOptions ? promptOptions : undefined,
          },
          {
            executionMode: "clipboard",
            stages: stageNumbers,
            onStageComplete: (stage: number, stageResult: StageResult) => {
              stageIndex++;
              printStageHeader(stageIndex, totalStages, stage);
              writeln(formatStageOutput(stageResult.output || stageResult.rawResponse));
            },
          },
        );

        // Write spec files
        const specsDir = join(process.cwd(), ".stoa", "specs");
        const slug = await resolveSlug(specsDir, toSlug(description));
        const stagesRun: Record<number, string> = {};
        for (const sr of result.stages) {
          stagesRun[sr.stage] = sr.rawResponse;
        }
        await writeSpecFiles(specsDir, slug, stagesRun);
        await writeRefineMeta(
          specsDir,
          slug,
          result.stages.map((s) => s.stage),
          result.executionMode,
          pkg.version,
        );

        await printPostRefineOutput(slug, result.finalSpecScore);
      } catch (err: unknown) {
        process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
        process.exit(1);
      }
      return;
    }

    const spinner = ora({ text: "", color: "cyan" });

    const stagesToRun = stageNumbers ?? [1, 2, 3, 4, 5] as (1 | 2 | 3 | 4 | 5)[];
    spinner.start(`Running stage: ${STAGE_DISPLAY_NAMES[stagesToRun[0]]}...`);

    try {
      const result = await refinePipeline(
        {
          title: description,
          description,
          role: opts.role,
          guardrails,
          moodboard,
          projectCtx,
          promptOptions: hasPromptOptions ? promptOptions : undefined,
        },
        {
          ...(executionMode ? { executionMode } : {}),
          stages: stageNumbers,
          onStageComplete: (stage: number, stageResult: StageResult) => {
            spinner.stop();
            stageIndex++;
            printStageHeader(stageIndex, totalStages, stage);
            writeln(formatStageOutput(stageResult.output || stageResult.rawResponse));

            // Start spinner for next stage if there are more
            if (stageIndex < totalStages) {
              const nextStage = stagesToRun[stageIndex];
              spinner.start(`Running stage: ${STAGE_DISPLAY_NAMES[nextStage]}...`);
            }
          },
        },
      );

      // Write spec files
      const specsDir = join(process.cwd(), ".stoa", "specs");
      const slug = await resolveSlug(specsDir, toSlug(description));
      const stagesRun: Record<number, string> = {};
      for (const sr of result.stages) {
        stagesRun[sr.stage] = sr.rawResponse;
      }
      await writeSpecFiles(specsDir, slug, stagesRun);
      await writeRefineMeta(
        specsDir,
        slug,
        result.stages.map((s) => s.stage),
        result.executionMode,
        pkg.version,
      );

      await printPostRefineOutput(slug, result.finalSpecScore);
    } catch (err: unknown) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── stoa score ────────────────────────────────────────────────────────

program
  .command("score")
  .description("Score a task description without running the full pipeline")
  .argument("<description>", "Task description to score")
  .action((description: string) => {
    const result = computeSpecScore({
      hasDescription: description.length > 0,
      descriptionLength: description.length,
      wasRefined: false,
      hasAcceptanceCriteria: false,
      hasGuardrails: false,
      hasRole: false,
      hasScenarios: false,
      hasSubtasks: false,
    });

    writeln(`Level: ${chalk.bold(result.level)}`);
    printScoreBadge(result.score);

    if (result.missing.length > 0) {
      writeln();
      writeln(chalk.dim("Missing:"));
      for (const item of result.missing) {
        writeln(chalk.dim(`  - ${item}`));
      }
    }
  });

// ── stoa specs ────────────────────────────────────────────────────────

const specsCmd = program
  .command("specs")
  .description("Manage saved specs (.stoa/specs/)");

specsCmd
  .command("list")
  .description("List all saved specs with date")
  .action(async () => {
    const specsDir = join(process.cwd(), ".stoa", "specs");
    const specs = await listSpecs(specsDir);

    if (specs.length === 0) {
      writeln(chalk.dim("No specs found. Run stoa refine <task> first."));
      return;
    }

    for (const spec of specs) {
      const dateStr = spec.date.toISOString().slice(0, 10);
      writeln(`${chalk.white(spec.name)}  ${chalk.dim(dateStr)}  ${chalk.dim(`${spec.stages} stage(s)`)}`);
    }
  });

specsCmd
  .command("show")
  .description("Show a saved spec's content")
  .argument("<name>", "Spec name (slug)")
  .action(async (name: string) => {
    const specsDir = join(process.cwd(), ".stoa", "specs");
    try {
      const content = await showSpec(specsDir, name);
      process.stdout.write(content);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

// ── stoa config ───────────────────────────────────────────────────────

const configCmd = program
  .command("config")
  .description("Manage global Stoa configuration (~/.stoa/config.json)");

configCmd
  .command("set")
  .description("Set a configuration value")
  .argument("<key>", "Configuration key")
  .argument("<value>", "Configuration value")
  .action(async (key: string, value: string) => {
    const config = await readConfig();
    config[key] = value;
    await writeConfig(config);
    writeln(chalk.green(`Set ${key}`));
  });

configCmd
  .command("get")
  .description("Get a configuration value")
  .argument("<key>", "Configuration key")
  .action(async (key: string) => {
    const config = await readConfig();
    const value = config[key];

    if (value === undefined) {
      writeln(chalk.dim(`(not set)`));
      return;
    }

    if (key.toLowerCase().endsWith("api_key")) {
      writeln(maskApiKey(value));
    } else {
      writeln(value);
    }
  });

// ── stoa edit ─────────────────────────────────────────────────────────

const EDITABLE_FILES: Record<string, string> = {
  moodboard: ".stoa/moodboard/notes.md",
  context: ".stoa/context.md",
  lessons: ".stoa/lessons.md",
};

program
  .command("edit")
  .description("Open a .stoa/ file in your editor")
  .argument("<file>", `File to edit (${Object.keys(EDITABLE_FILES).join(", ")})`)
  .action((file: string) => {
    const relativePath = EDITABLE_FILES[file];
    if (!relativePath) {
      process.stderr.write(
        chalk.red(`Unknown file: "${file}". Valid: ${Object.keys(EDITABLE_FILES).join(", ")}`) + "\n",
      );
      process.exit(1);
    }

    const fullPath = join(process.cwd(), relativePath);
    if (!existsSync(fullPath)) {
      process.stderr.write(chalk.red(`File not found: ${relativePath}. Run 'stoa init' first.`) + "\n");
      process.exit(1);
    }

    // Detect best editor: cursor → code → $EDITOR → open (macOS) → nano
    const editor = detectEditor();
    const child = spawn(editor, [fullPath], { stdio: "inherit" });
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });

// ── stoa init ─────────────────────────────────────────────────────────

program
  .command("init")
  .description("Initialize a .stoa/ directory in the current working directory")
  .option("--name <name>", "Project name (defaults to current directory name)")
  .option("--type <type>", "Project type", "generic")
  .option("--no-templates", "Skip copying starter templates")
  .action(async (opts: { name?: string; type: string; templates: boolean }) => {
    const name = opts.name ?? basename(process.cwd());
    const created = await initProject(name, opts.type, !opts.templates);

    if (!created) {
      process.exit(1);
    }

    writeln(chalk.green("Created .stoa/ with:"));
    if (opts.templates) {
      writeln(chalk.green("  5 guardrails"));
      writeln(chalk.green("  3 roles (Builder, Fixer, Planner)"));
    }
    writeln(chalk.green("  moodboard/notes.md — design direction"));
    writeln(chalk.green("  context.md — brand voice, dependencies, conventions"));
    writeln(chalk.green("  lessons.md — project memory (grows automatically)"));
    writeln();
    writeln(`Run ${chalk.cyan("stoa refine \"your idea\"")} to get started`);
    writeln(chalk.dim("Optional: edit moodboard/notes.md and context.md to customize your design system"));
  });

// ── stoa guardrails ──────────────────────────────────────────────────

const guardrailsCmd = program
  .command("guardrails")
  .description("Manage project guardrails (.stoa/guardrails/)");

guardrailsCmd
  .command("list")
  .description("List all guardrails")
  .action(() => {
    const items = listGuardrails();
    if (items.length === 0) {
      writeln(chalk.dim("No guardrails found."));
      return;
    }
    for (const item of items) {
      writeln(`${item.slug}: ${item.title}`);
    }
  });

guardrailsCmd
  .command("add")
  .description("Add a new guardrail")
  .argument("<title>", "Guardrail title")
  .action((title: string) => {
    try {
      addGuardrail(title);
      writeln(chalk.green(`Added: ${toSlug(title)}`));
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

guardrailsCmd
  .command("show")
  .description("Show a guardrail's content")
  .argument("<slug>", "Guardrail slug")
  .action((slug: string) => {
    try {
      const content = showGuardrail(slug);
      process.stdout.write(content);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

guardrailsCmd
  .command("remove")
  .description("Remove a guardrail")
  .argument("<slug>", "Guardrail slug")
  .action(async (slug: string) => {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Remove ${slug}? (y/N) `, (answer) => {
      rl.close();
      if (answer.toLowerCase() !== "y") {
        return;
      }
      try {
        removeGuardrail(slug);
        writeln(chalk.green(`Removed: ${slug}`));
      } catch (err: unknown) {
        process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
        process.exit(1);
      }
    });
  });

guardrailsCmd
  .command("refine")
  .description("Refine a guardrail through a 3-stage pipeline (clarify → verify → examples)")
  .argument("<name>", "Guardrail slug name")
  .option("--mode <mode>", "Execution mode (clipboard|api|claude-code)", "clipboard")
  .action(async (name: string, opts: { mode: string }) => {
    const validModes = ["clipboard", "api", "claude-code"] as const;
    type Mode = (typeof validModes)[number];

    if (!validModes.includes(opts.mode as Mode)) {
      process.stderr.write(
        chalk.red(`Invalid mode: "${opts.mode}". Valid modes: ${validModes.join(", ")}`) + "\n",
      );
      process.exit(1);
    }

    const mode = opts.mode as Mode;

    if (mode === "clipboard") {
      try {
        const result = await refineGuardrail({
          name,
          mode,
          onStageComplete: (i, label, output) => {
            const line = "─".repeat(40);
            writeln(`\n${line}`);
            writeln(chalk.bold(label));
            writeln(line);
            writeln(output);
          },
        });
        // result.prompts are printed via onStageComplete
        void result;
      } catch (err: unknown) {
        process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
        process.exit(1);
      }
      return;
    }

    // api or claude-code mode
    const spinner = ora({ text: "", color: "cyan" });
    spinner.start("Stage 1: Clarify & Tighten...");

    try {
      await refineGuardrail({
        name,
        mode,
        onStageComplete: (i, label) => {
          spinner.succeed(label);
          if (i < 2) {
            const nextLabels = [
              "Stage 2: Add Verification...",
              "Stage 3: Add Examples...",
            ];
            spinner.start(nextLabels[i]);
          }
        },
      });

      writeln(chalk.green(`\nUpdated: .stoa/guardrails/${name}.md`));
    } catch (err: unknown) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── stoa export ───────────────────────────────────────────────────────

program
  .command("export")
  .description("Export configuration in a specific format")
  .argument("<format>", "Export format (e.g. claude-md)")
  .action(async (format: string) => {
    if (format !== "claude-md") {
      process.stderr.write(chalk.red(`Unknown export format: "${format}". Supported: claude-md`) + "\n");
      process.exit(1);
    }

    // Try local config first, then global
    let config: Record<string, unknown> = {};
    const localPath = join(process.cwd(), ".stoa", "config.json");

    try {
      const raw = await readFile(localPath, "utf-8");
      config = JSON.parse(raw);
    } catch {
      try {
        const raw = await readFile(GLOBAL_CONFIG_PATH, "utf-8");
        config = JSON.parse(raw);
      } catch {
        // empty config
      }
    }

    const lines: string[] = [
      "# Stoa Configuration",
      "",
    ];

    if (config.stages) {
      lines.push("## Pipeline Stages");
      lines.push("");
      const stages = config.stages as string[];
      for (const stage of stages) {
        lines.push(`- ${stage}`);
      }
      lines.push("");
    }

    // Include any other config keys
    for (const [key, value] of Object.entries(config)) {
      if (key === "stages") continue;
      if (typeof key === "string" && key.toLowerCase().endsWith("api_key")) continue;
      lines.push(`## ${key}`);
      lines.push("");
      lines.push(typeof value === "string" ? value : JSON.stringify(value, null, 2));
      lines.push("");
    }

    // Read guardrails if present
    const guardrailsDir = join(process.cwd(), ".stoa", "guardrails");
    if (existsSync(guardrailsDir)) {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(guardrailsDir);
      const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
      if (mdFiles.length > 0) {
        lines.push("## Guardrails");
        lines.push("");
        for (const file of mdFiles) {
          const content = await readFile(join(guardrailsDir, file), "utf-8");
          lines.push(content);
          lines.push("");
        }
      }
    }

    process.stdout.write(lines.join("\n"));
  });

// ── stoa roles ───────────────────────────────────────────────────────

const rolesCmd = program
  .command("roles")
  .description("Manage project roles (.stoa/roles/)");

rolesCmd
  .command("list")
  .description("List all roles")
  .action(() => {
    const slugs = listRoles();
    for (const slug of slugs) {
      writeln(slug);
    }
  });

rolesCmd
  .command("add")
  .description("Add a new role")
  .argument("<displayName>", "Role display name")
  .action((displayName: string) => {
    try {
      addRole(displayName);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

rolesCmd
  .command("show")
  .description("Show a role's content")
  .argument("<slug>", "Role slug")
  .action((slug: string) => {
    try {
      const content = showRole(slug);
      process.stdout.write(content);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

rolesCmd
  .command("remove")
  .description("Remove a role")
  .argument("<slug>", "Role slug")
  .action((slug: string) => {
    try {
      removeRole(slug);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

rolesCmd
  .command("refine")
  .description("Refine a role through a 3-stage pipeline (sharpen → boundaries → guardrails)")
  .argument("<name>", "Role slug name")
  .option("--mode <mode>", "Execution mode (clipboard|api|claude-code)", "clipboard")
  .action(async (name: string, opts: { mode: string }) => {
    const validModes = ["clipboard", "api", "claude-code"] as const;
    type Mode = (typeof validModes)[number];

    if (!validModes.includes(opts.mode as Mode)) {
      process.stderr.write(
        chalk.red(`Invalid mode: "${opts.mode}". Valid modes: ${validModes.join(", ")}`) + "\n",
      );
      process.exit(1);
    }

    const mode = opts.mode as Mode;

    if (mode === "clipboard") {
      try {
        const result = await refineRole({
          name,
          mode,
          onStageComplete: (i, label, output) => {
            const line = "─".repeat(40);
            writeln(`\n${line}`);
            writeln(chalk.bold(label));
            writeln(line);
            writeln(output);
          },
        });
        void result;
      } catch (err: unknown) {
        process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
        process.exit(1);
      }
      return;
    }

    // api or claude-code mode
    const spinner = ora({ text: "", color: "cyan" });
    spinner.start("Stage 1: Sharpen Identity...");

    try {
      const result = await refineRole({
        name,
        mode,
        onStageComplete: (i, label, output) => {
          spinner.succeed(label);
          if (i === 0) {
            spinner.start("Stage 2: Define Boundaries...");
          } else if (i === 1) {
            writeln(chalk.green(`\nUpdated: .stoa/roles/${name}.md`));
            spinner.start("Stage 3: Suggest Guardrails...");
          } else if (i === 2) {
            // Stage 3: print guardrail suggestions to terminal only
            const line = "─".repeat(40);
            writeln(`\n${line}`);
            writeln(chalk.bold("Suggested Guardrails (review & create manually):"));
            writeln(line);
            writeln(output);
          }
        },
      });
      void result;
    } catch (err: unknown) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── stoa scenarios ───────────────────────────────────────────────────

const scenariosCmd = program
  .command("scenarios")
  .description("Manage project scenarios (.stoa/scenarios/)");

scenariosCmd
  .command("list")
  .description("List all scenarios for a task")
  .argument("<name>", "Scenario set name")
  .action((name: string) => {
    const scenarios = listScenarios(name);
    for (let i = 0; i < scenarios.length; i++) {
      writeln(`[${i}] title: ${scenarios[i].title}`);
    }
  });

scenariosCmd
  .command("show")
  .description("Show scenarios with details")
  .argument("<name>", "Scenario set name")
  .action((name: string) => {
    try {
      const scenarios = showScenarios(name);
      for (let i = 0; i < scenarios.length; i++) {
        writeln(`[${i}] GIVEN: ${scenarios[i].given}`);
        writeln(`    EXPECTED: ${scenarios[i].expected}`);
      }
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

scenariosCmd
  .command("add")
  .description("Add a scenario")
  .argument("<name>", "Scenario set name")
  .requiredOption("--title <string>", "Scenario title")
  .requiredOption("--given <string>", "Given condition")
  .requiredOption("--expected <string>", "Expected outcome")
  .action((name: string, opts: { title: string; given: string; expected: string }) => {
    addScenario(name, { title: opts.title, given: opts.given, expected: opts.expected });
  });

scenariosCmd
  .command("remove")
  .description("Remove a scenario by index")
  .argument("<name>", "Scenario set name")
  .requiredOption("--index <number>", "Index to remove", parseInt)
  .action((name: string, opts: { index: number }) => {
    try {
      removeScenario(name, opts.index);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

scenariosCmd
  .command("run")
  .description("Interactively walk through scenarios for a spec")
  .argument("[specName]", "Spec name (defaults to most recent)")
  .action(async (specNameArg?: string) => {
    try {
      await runSpecScenarios(specNameArg);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

scenariosCmd
  .command("generate")
  .description("Generate structured scenarios from a task spec (.stoa/specs/<taskName>.json)")
  .argument("<taskName>", "Task name (matches spec filename)")
  .option("--mode <mode>", "Execution mode (api|clipboard|cli)", "clipboard")
  .action(async (taskName: string, opts: { mode: string }) => {
    const validModes = ["api", "clipboard", "cli"] as const;
    type Mode = (typeof validModes)[number];

    if (!validModes.includes(opts.mode as Mode)) {
      process.stderr.write(
        chalk.red(`Invalid mode: "${opts.mode}". Valid modes: ${validModes.join(", ")}`) + "\n",
      );
      process.exit(1);
    }

    await generateScenarios(taskName, opts.mode as Mode);
  });

// ── stoa moodboard ──────────────────────────────────────────────────

const moodboardCmd = program
  .command("moodboard")
  .description("Manage project moodboard (.stoa/moodboard/)")
  .action(() => {
    // No subcommand → show status
    const cwd = process.cwd();
    const notesPath = join(cwd, ".stoa", "moodboard", "notes.md");
    const tokensPath = join(cwd, ".stoa", "moodboard", "tokens.json");

    if (!existsSync(join(cwd, ".stoa"))) {
      writeln(chalk.red("No .stoa/ directory. Run 'stoa init' first."));
      process.exit(1);
    }

    writeln();
    writeln(chalk.bold("Moodboard Status"));
    writeln();

    // Check notes.md
    if (existsSync(notesPath)) {
      const raw = readFileSync(notesPath, "utf-8");
      const stripped = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/^#.*$/gm, "").trim();
      if (stripped.length > 0) {
        // Extract design direction (first non-empty section)
        const dirMatch = raw.match(/# Design Direction\n([^\n#]+)/);
        if (dirMatch) {
          writeln(`  Style: ${chalk.cyan(dirMatch[1].trim())}`);
        }
      } else {
        writeln(`  Style: ${chalk.dim("(empty — run 'stoa moodboard preset' to set one)")}`);
      }
    } else {
      writeln(`  Style: ${chalk.dim("(no notes.md)")}`);
    }

    // Check tokens
    if (existsSync(tokensPath)) {
      try {
        const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
        const colorCount = tokens.colors ? Object.keys(tokens.colors).length : 0;
        writeln(`  Colors: ${colorCount > 0 ? chalk.green(`${colorCount} defined`) : chalk.dim("none")}`);
      } catch {
        writeln(`  Tokens: ${chalk.dim("invalid")}`);
      }
    } else {
      writeln(`  Tokens: ${chalk.dim("not synced")}`);
    }

    // Check images
    const moodboardDir = join(cwd, ".stoa", "moodboard");
    if (existsSync(moodboardDir)) {
      try {
        const files = readdirSync(moodboardDir);
        const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
        const imageCount = files.filter((f) => imageExts.has(extname(f).toLowerCase())).length;
        writeln(`  Images: ${imageCount > 0 ? chalk.green(`${imageCount} screenshot(s)`) : chalk.dim("none")}`);
      } catch {
        // ignore
      }
    }

    writeln();
    writeln(chalk.bold("Commands:"));
    writeln(`  ${chalk.cyan("stoa moodboard preset")}       Switch style preset`);
    writeln(`  ${chalk.cyan("stoa moodboard edit")}          Edit interactively`);
    writeln(`  ${chalk.cyan("stoa moodboard describe")}      Extract design from screenshots`);
    writeln(`  ${chalk.cyan("stoa moodboard sync")}          Regenerate tokens.json`);
    writeln(`  ${chalk.cyan("stoa moodboard save-preset")}   Save current as reusable preset`);
    writeln(`  ${chalk.cyan("stoa edit moodboard")}          Open in editor`);
    writeln();
  });

moodboardCmd
  .command("preset")
  .description("Choose a style preset for your moodboard")
  .argument("[name]", "Preset name (omit for interactive picker)")
  .action(async (name?: string) => {
    const cwd = process.cwd();

    if (name) {
      // Direct apply by name
      const preset = loadPreset(cwd, name);
      if (!preset) {
        const available = listPresets(cwd).map((e) => e.id).join(", ");
        process.stderr.write(chalk.red(`Preset "${name}" not found. Available: ${available}`) + "\n");
        process.exit(1);
      }
      applyPreset(cwd, preset);
      writeln(chalk.green(`Applied "${preset.name}" preset.`));
      return;
    }

    // Interactive picker
    const entries = listPresets(cwd);
    if (entries.length === 0) {
      writeln(chalk.red("No presets found."));
      process.exit(1);
    }

    const selected = await pickPreset(entries);
    if (!selected) {
      writeln(chalk.dim("Cancelled."));
      return;
    }

    applyPreset(cwd, selected.preset);
    writeln(chalk.green(`Applied "${selected.preset.name}" preset.`));
    writeln(chalk.dim("Run 'stoa moodboard edit' to customize, or 'stoa refine' to use it."));
  });

moodboardCmd
  .command("edit")
  .description("Edit moodboard interactively in the terminal")
  .action(async () => {
    try {
      await runMoodboardEdit(process.cwd());
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

moodboardCmd
  .command("sync")
  .description("Parse notes.md and generate tokens.json")
  .action(() => {
    try {
      const tokens = syncMoodboard(process.cwd());
      writeln(chalk.green("Generated .stoa/moodboard/tokens.json"));
      writeln();
      const entries = Object.entries(tokens);
      if (entries.length === 0) {
        writeln(chalk.dim("No values found. Add content to .stoa/moodboard/notes.md first."));
      } else {
        writeln("Extracted:");
        for (const [key, value] of entries) {
          if (typeof value === "string") {
            writeln(`  ${key}: ${value}`);
          } else if (value && typeof value === "object") {
            const count = Object.keys(value).length;
            writeln(`  ${key}: ${count} value(s)`);
          }
        }
      }
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

moodboardCmd
  .command("describe")
  .description("AI-extract design system from screenshots in moodboard/")
  .option("--mode <mode>", "Execution mode (api|claude-code|clipboard)")
  .option("--overwrite", "Overwrite notes.md without prompting")
  .action(async (opts: { mode?: string; overwrite?: boolean }) => {
    const validModes = ["api", "claude-code", "clipboard"] as const;
    type Mode = (typeof validModes)[number];

    if (opts.mode && !validModes.includes(opts.mode as Mode)) {
      process.stderr.write(
        chalk.red(`Invalid mode: "${opts.mode}". Valid: ${validModes.join(", ")}`) + "\n",
      );
      process.exit(1);
    }

    // Auto-detect mode if not specified
    let mode: Mode;
    if (opts.mode) {
      mode = opts.mode as Mode;
    } else if (process.env.ANTHROPIC_API_KEY) {
      mode = "api";
    } else {
      mode = "clipboard";
    }

    // Open moodboard folder so user can drop screenshots
    const moodboardDir = join(process.cwd(), ".stoa", "moodboard");
    if (existsSync(moodboardDir)) {
      writeln(chalk.cyan("Opening moodboard folder — drop your screenshots in..."));
      if (process.platform === "darwin") {
        spawn("open", [moodboardDir], { stdio: "ignore", detached: true });
      } else {
        spawn("xdg-open", [moodboardDir], { stdio: "ignore", detached: true });
      }

      // Wait for user to confirm
      if (process.stdin.isTTY) {
        const { createInterface } = await import("node:readline");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>((resolve) => {
          rl.question(chalk.dim("Press Enter when ready → "), () => {
            rl.close();
            resolve();
          });
        });
      }
    }

    const spinner = mode === "api" ? ora({ text: "Analyzing screenshots...", color: "cyan" }) : null;

    try {
      if (spinner) spinner.start();

      const result = await describeMoodboard(process.cwd(), {
        mode,
        overwrite: opts.overwrite,
        apiKey: process.env.ANTHROPIC_API_KEY,
        onConfirm: async () => {
          if (spinner) spinner.stop();
          const { createInterface } = await import("node:readline");
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          return new Promise<boolean>((resolve) => {
            rl.question("notes.md has content. Overwrite? [y/N] ", (answer) => {
              rl.close();
              const yes = answer.trim().toLowerCase() === "y";
              if (yes && spinner) spinner.start();
              resolve(yes);
            });
          });
        },
      });

      if (spinner) spinner.stop();

      if (result.written) {
        writeln(chalk.green(`Extracted design system from ${result.imageCount} image(s).`));
        writeln(chalk.green("Updated notes.md and tokens.json."));
      } else {
        writeln(result.output);
      }
    } catch (err: unknown) {
      if (spinner) spinner.fail();
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

moodboardCmd
  .command("save-preset")
  .description("Save current moodboard as a reusable preset")
  .argument("<name>", "Name for the preset")
  .action((name: string) => {
    try {
      const preset = savePreset(process.cwd(), name);
      writeln(chalk.green(`Saved preset "${preset.name}" to .stoa/presets/${name}.json`));
      writeln(chalk.dim("Use 'stoa moodboard preset' to apply it in other projects."));
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

// ── stoa review ──────────────────────────────────────────────────────

program
  .command("review")
  .description("Review a refined spec interactively, then optionally re-run affected stages")
  .argument("[specName]", "Spec name (defaults to most recent)")
  .action(async (specNameArg?: string) => {
    let specName: string;
    try {
      specName = await resolveSpecName(specNameArg);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }

    const specDir = join(process.cwd(), ".stoa", "specs", specName);

    // 1. Capture snapshot
    const snapshot = await snapshotSpecFiles(specDir);

    // 2. Run interactive review loop
    await runReviewLoop(specDir);

    // 3. Detect changes made during review
    const affectedStages = await detectChanges(specDir, snapshot);

    // 4. Prompt user about re-running affected stages
    const success = await promptAndRerun(affectedStages, specDir);

    if (success) {
      // 5. Write .approved marker
      const approvedPath = join(specDir, ".approved");
      await writeFile(approvedPath, new Date().toISOString(), "utf-8");
      writeln(chalk.green(`Approved: ${specName}`));
    } else {
      process.stderr.write(chalk.red(`Review failed for spec "${specName}". Spec was not approved.`) + "\n");
      process.exit(1);
    }
  });

// ── stoa build ───────────────────────────────────────────────────────

program
  .command("build")
  .description("Launch a build from an approved spec")
  .argument("[specName]", "Spec name to build (defaults to most recent approved spec)")
  .option("--fix <number>", "Apply a fix spec before building (reads .stoa/specs/<name>/fixes/fix-<NNN>.md)")
  .action(async (specNameArg: string | undefined, opts: { fix?: string }) => {
    let specName: string;
    try {
      specName = await resolveSpecName(specNameArg);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }

    const approvedPath = join(process.cwd(), ".stoa", "specs", specName, ".approved");

    try {
      await access(approvedPath, constants.F_OK);
    } catch {
      process.stderr.write(
        chalk.red(`Error: Spec "${specName}" has not been reviewed. Run \`stoa review ${specName}\` first.`) + "\n",
      );
      process.exit(1);
    }

    // Handle --fix N: read the fix file and use it as the prompt
    let fixPrompt: string | undefined;
    if (opts.fix) {
      const fixNum = parseInt(opts.fix, 10);
      const padded = String(fixNum).padStart(3, "0");
      const fixPath = join(process.cwd(), ".stoa", "specs", specName, "fixes", `fix-${padded}.md`);

      if (!existsSync(fixPath)) {
        process.stderr.write(
          chalk.red(`Error: Fix file not found: .stoa/specs/${specName}/fixes/fix-${padded}.md`) + "\n",
        );
        process.exit(1);
      }

      fixPrompt = readFileSync(fixPath, "utf-8");
      writeln(chalk.cyan(`Applying fix ${fixNum} for spec: ${chalk.white(specName)}`));
    }

    const config = await loadConfig();
    const role = config.defaultRole ?? "builder";

    writeln(chalk.cyan(`Building from spec: ${chalk.white(specName)}`));
    writeln(chalk.dim(`Role: ${role}`));

    const basePrompt = composePrompt(specName, { role });

    // If --fix, append fix content to the prompt
    const prompt = fixPrompt
      ? basePrompt + "\n\n# Fix Spec\n" + fixPrompt
      : basePrompt;

    // Check for subtasks in the spec
    const subtasksPath = join(process.cwd(), ".stoa", "specs", specName, "04-decomposition.md");
    const subtasksContent = existsSync(subtasksPath) ? readFileSync(subtasksPath, "utf-8") : "";
    const subtasks = parseSubtasks(subtasksContent);

    try {
      if (fixPrompt || subtasks.length === 0) {
        // --fix mode or no subtasks: single build
        await runBuild(specName, prompt);
      } else {
        writeln(chalk.cyan(`\nFound ${subtasks.length} subtask(s):`));
        for (const st of subtasks) {
          writeln(chalk.dim(`  ${st.index}. ${st.text.split("\n")[0]}`));
        }
        writeln("");

        const choice = await promptSubtaskChoice(subtasks);

        if (choice === "q") {
          process.exit(0);
        } else if (choice === "all") {
          for (const st of subtasks) {
            writeln(chalk.cyan(`\n── Subtask ${st.index}/${subtasks.length} ──\n`));
            await runBuild(specName, prompt + `\n\n# Current Subtask\n${st.text}`);
          }
        } else {
          const num = parseInt(choice, 10);
          const picked = subtasks.find((s) => s.index === num);
          if (!picked) {
            process.stderr.write(chalk.red(`Invalid choice: "${choice}". Expected all, 1-${subtasks.length}, or q.\n`));
            process.exit(1);
          }
          writeln(chalk.cyan(`\n── Subtask ${picked.index} ──\n`));
          await runBuild(specName, prompt + `\n\n# Current Subtask\n${picked.text}`);
        }
      }

      // If --fix mode, run verify automatically after build completes
      if (fixPrompt) {
        writeln(chalk.cyan("\nRunning verification..."));
        await runVerify(specName);
      }
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
        process.exit(1);
      }
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }
  });

// ── stoa verify ─────────────────────────────────────────────────────

program
  .command("verify")
  .description("Interactively verify scenarios for a spec")
  .argument("[specName]", "Spec name to verify (defaults to most recent spec)")
  .action(async (specNameArg: string | undefined) => {
    let specName: string;
    try {
      specName = await resolveSpecName(specNameArg);
    } catch (err: unknown) {
      process.stderr.write(chalk.red(err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(1);
    }

    await runVerify(specName);
  });

// ── Parse ─────────────────────────────────────────────────────────────

program.parse();
