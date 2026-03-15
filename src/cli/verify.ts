import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario } from "../storage/scenarios.js";

export interface VerifyFailure {
  scenarioId: number;
  expected: string;
  actual: string;
}

export interface VerifyResult {
  passed: number;
  failed: number;
  skipped: number;
  failures: VerifyFailure[];
}

function readKeypress(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (data: Buffer) => {
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve(data);
    });
    process.stdin.once("error", (err: Error) => {
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      reject(err);
    });
  });
}

/**
 * Load scenarios from .stoa/specs/<name>/05-evaluation-design.md.
 * Tries JSON.parse first. If that fails, extracts JSON array from markdown
 * (finds first '[' and last ']'). Falls back to parsing GIVEN/EXPECTED blocks.
 */
function loadSpecScenarios(name: string): Scenario[] {
  const scenariosPath = join(process.cwd(), ".stoa", "specs", name, "05-evaluation-design.md");

  if (!existsSync(scenariosPath)) {
    throw new Error(`Scenarios file not found: .stoa/specs/${name}/05-evaluation-design.md`);
  }

  const content = readFileSync(scenariosPath, "utf-8");

  // Try JSON.parse on full content
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as Scenario[];
  } catch {
    // Not pure JSON — try extracting embedded JSON
  }

  // Try extracting JSON array from markdown
  const firstBracket = content.indexOf("[");
  const lastBracket = content.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const jsonStr = content.slice(firstBracket, lastBracket + 1);
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) return parsed as Scenario[];
    } catch {
      // Not valid JSON — fall through to text parsing
    }
  }

  // Parse formatted scenarios: **Scenario N**\nGIVEN: ...\nEXPECTED: ...
  const scenarios: Scenario[] = [];
  const pattern = /\*\*Scenario\s+\d+\*\*\s*\n\s*GIVEN:\s*(.+)\s*\n\s*EXPECTED:\s*(.+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    scenarios.push({
      title: `Scenario ${scenarios.length + 1}`,
      given: match[1].trim(),
      expected: match[2].trim(),
    });
  }

  return scenarios;
}

export async function runVerify(name: string): Promise<VerifyResult> {
  let scenarios: Scenario[];
  try {
    scenarios = loadSpecScenarios(name);
  } catch {
    process.stderr.write(`Error: scenarios file not found: .stoa/specs/${name}/05-evaluation-design.md\n`);
    process.exit(1);
  }

  if (scenarios.length === 0) {
    process.stderr.write(`No scenarios found in ${name}\n`);
    process.exit(1);
  }

  const total = scenarios.length;
  const result: VerifyResult = { passed: 0, failed: 0, skipped: 0, failures: [] };

  for (let i = 0; i < total; i++) {
    const s = scenarios[i];
    process.stdout.write(`\nScenario ${i + 1} of ${total}\n`);
    process.stdout.write(`  GIVEN:    ${s.given}\n`);
    process.stdout.write(`  WHEN:     ${s.title}\n`);
    process.stdout.write(`  EXPECTED: ${s.expected}\n`);
    process.stdout.write(`  Result? [p]ass / [f]ail / [s]kip: `);

    let answered = false;
    while (!answered) {
      const buf = await readKeypress();
      const ch = String.fromCharCode(buf[0]).toLowerCase();

      if (ch === "p") {
        process.stdout.write("pass\n");
        result.passed++;
        answered = true;
      } else if (ch === "s") {
        process.stdout.write("skip\n");
        result.skipped++;
        answered = true;
      } else if (ch === "f") {
        process.stdout.write("fail\n");

        // Switch to line mode for failure description
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const response = await rl.question("  What went wrong? ");
        rl.close();

        result.failed++;
        result.failures.push({
          scenarioId: i,
          expected: s.expected,
          actual: response,
        });
        answered = true;
      }
      // Other keys: ignore, loop re-prompts
    }
  }

  if (result.failures.length > 0) {
    const fixesDir = join(process.cwd(), ".stoa", "specs", name, "fixes");
    mkdirSync(fixesDir, { recursive: true });

    // Count existing fix-NNN.md files to determine next number
    const existing = existsSync(fixesDir)
      ? readdirSync(fixesDir).filter((f) => /^fix-\d+\.md$/.test(f))
      : [];
    const nextNum = existing.length + 1;
    const padded = String(nextNum).padStart(3, "0");
    const fixPath = join(fixesDir, `fix-${padded}.md`);

    const lines: string[] = [`# Fix ${padded}`, ""];
    lines.push("## Failed Scenarios", "");
    for (const f of result.failures) {
      const s = scenarios[f.scenarioId];
      lines.push(`- **${s.title}** (scenario ${f.scenarioId})`);
      lines.push(`  - Expected: ${f.expected}`);
      lines.push(`  - Actual: ${f.actual}`);
    }
    lines.push("", "## Fix Task", "");
    lines.push("<!-- Describe what needs to change to fix the failures above -->", "");

    writeFileSync(fixPath, lines.join("\n"), "utf-8");

    const relPath = `.stoa/specs/${name}/fixes/fix-${padded}.md`;
    process.stdout.write(`\nFix file created: ${relPath}\n`);
    process.stdout.write(`Run: stoa build ${name} --fix ${nextNum}\n`);
  }

  process.stdout.write(`\nPassed: ${result.passed} | Failed: ${result.failed} | Skipped: ${result.skipped}\n`);

  return result;
}
