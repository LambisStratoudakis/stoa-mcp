import { createInterface } from "node:readline";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Scenario {
  title: string;
  given: string;
  expected: string;
}

function parseSpecScenarios(content: string): Scenario[] {
  const scenarios: Scenario[] = [];

  // Strip markdown code fences if present
  const stripped = content.replace(/^```(?:json)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "");
  const trimmed = stripped.trim();

  // Try JSON array first (raw stage 5 output)
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            typeof item === "object" && item !== null &&
            typeof (item as Record<string, unknown>).title === "string" &&
            typeof (item as Record<string, unknown>).given === "string" &&
            typeof (item as Record<string, unknown>).expected === "string"
          ) {
            scenarios.push(item as Scenario);
          }
        }
        if (scenarios.length > 0) return scenarios;
      }
    } catch {
      // Not JSON — fall through to markdown parsing
    }
  }

  // Parse markdown format: ## Title blocks with **Given:**/**Expected:** or Given:/Expected:
  const blocks = content.split(/^##\s+/m);
  for (const block of blocks) {
    const blockTrimmed = block.trim();
    if (blockTrimmed.length === 0) continue;

    const firstNewline = blockTrimmed.indexOf("\n");
    if (firstNewline === -1) continue;

    const title = blockTrimmed.slice(0, firstNewline).trim();
    const body = blockTrimmed.slice(firstNewline + 1);

    const givenMatch = body.match(/\*{0,2}(?:given|GIVEN)\*{0,2}[:\s]+(.+?)(?=\*{0,2}(?:expected|EXPECTED)\*{0,2}[:\s])/is);
    const expectedMatch = body.match(/\*{0,2}(?:expected|EXPECTED)\*{0,2}[:\s]+(.+)/is);

    if (givenMatch && expectedMatch) {
      scenarios.push({
        title,
        given: givenMatch[1].replace(/^\*+|\*+$/g, "").trim(),
        expected: expectedMatch[1].replace(/^\*+|\*+$/g, "").trim(),
      });
    }
  }

  // Fallback: numbered list with title / given / expected per block
  if (scenarios.length === 0) {
    const numberedBlocks = content.split(/^\d+\.\s+/m);
    for (const block of numberedBlocks) {
      const blockTrimmed = block.trim();
      if (blockTrimmed.length === 0) continue;

      const titleMatch = blockTrimmed.match(/^\*{0,2}(.+?)\*{0,2}\s*$/m);
      const givenMatch = blockTrimmed.match(/\*{0,2}(?:given|GIVEN)\*{0,2}[:\s]+(.+?)(?=\*{0,2}(?:expected|EXPECTED)\*{0,2}[:\s])/is);
      const expectedMatch = blockTrimmed.match(/\*{0,2}(?:expected|EXPECTED)\*{0,2}[:\s]+(.+)/is);

      if (titleMatch && givenMatch && expectedMatch) {
        scenarios.push({
          title: titleMatch[1].replace(/^\*+|\*+$/g, "").trim(),
          given: givenMatch[1].replace(/^\*+|\*+$/g, "").trim(),
          expected: expectedMatch[1].replace(/^\*+|\*+$/g, "").trim(),
        });
      }
    }
  }

  return scenarios;
}

async function getMostRecentSpec(): Promise<string> {
  const specsDir = join(process.cwd(), ".stoa", "specs");
  const entries = await readdir(specsDir);
  const { stat } = await import("node:fs/promises");

  const dirs: { name: string; mtime: number }[] = [];
  for (const entry of entries) {
    const s = await stat(join(specsDir, entry));
    if (s.isDirectory()) {
      dirs.push({ name: entry, mtime: s.mtimeMs });
    }
  }

  if (dirs.length === 0) {
    throw new Error("No specs found. Run 'stoa refine' first.");
  }

  dirs.sort((a, b) => b.mtime - a.mtime);
  return dirs[0].name;
}

export async function loadSpecScenarios(specName?: string): Promise<{ specName: string; scenarios: Scenario[] }> {
  const resolvedName = specName ?? await getMostRecentSpec();
  const specDir = join(process.cwd(), ".stoa", "specs", resolvedName);
  const scenarioFile = join(specDir, "05-evaluation-design.md");

  let content: string;
  try {
    content = await readFile(scenarioFile, "utf-8");
  } catch {
    throw new Error(`No scenarios found for spec "${resolvedName}". Run a full refine first.`);
  }

  const scenarios = parseSpecScenarios(content);
  if (scenarios.length === 0) {
    throw new Error(`Could not parse scenarios from spec "${resolvedName}".`);
  }

  return { specName: resolvedName, scenarios };
}

function askQuestion(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function runSpecScenarios(specName?: string): Promise<void> {
  const { specName: name, scenarios } = await loadSpecScenarios(specName);

  process.stdout.write(`\nScenarios for: ${name}\n`);
  process.stdout.write(`${scenarios.length} scenario(s)\n`);
  process.stdout.write("─".repeat(40) + "\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: string[] = [];

  try {
    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i];
      process.stdout.write(`\nScenario ${i + 1}/${scenarios.length}: ${s.title}\n\n`);
      process.stdout.write(`  GIVEN:\n  ${s.given}\n\n`);
      process.stdout.write(`  EXPECTED:\n  ${s.expected}\n\n`);

      const answer = await askQuestion(rl, "  Pass? [y/n/s(skip)] ");

      if (answer === "y" || answer === "yes") {
        passed++;
        process.stdout.write("  ✓ Passed\n");
      } else if (answer === "s" || answer === "skip") {
        skipped++;
        process.stdout.write("  — Skipped\n");
      } else {
        failed++;
        failures.push(s.title);
        process.stdout.write("  ✗ Failed\n");
      }
    }
  } finally {
    rl.close();
  }

  // Summary
  process.stdout.write("\n" + "─".repeat(40) + "\n");
  process.stdout.write(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failures.length > 0) {
    process.stdout.write("Failed:\n");
    for (const f of failures) {
      process.stdout.write(`  - ${f}\n`);
    }
  }
}
