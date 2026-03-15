import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const SECTIONS: ReadonlyArray<{ display: string; file: string }> = [
  { display: "DESCRIPTION", file: "01-problem-statement.md" },
  { display: "CRITERIA", file: "02-acceptance-criteria.md" },
  { display: "CONSTRAINTS", file: "03-constraints.md" },
  { display: "SUBTASKS", file: "04-decomposition.md" },
  { display: "SCENARIOS", file: "05-evaluation-design.md" },
];

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

async function readSectionContent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function runReviewLoop(
  specDir: string,
): Promise<void> {
  for (const section of SECTIONS) {
    const filePath = join(specDir, section.file);

    process.stdout.write(`\n=== ${section.display} ===\n`);

    const content = await readSectionContent(filePath);
    if (content === null) {
      process.stdout.write("[no content]\n");
    } else {
      process.stdout.write(content);
      if (!content.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }

    let handled = false;
    while (!handled) {
      process.stdout.write("[Enter] continue  [e] edit  [s] skip");

      const buf = await readKeypress();
      const byte = buf[0];
      process.stdout.write("\n");

      if (byte === 0x0d || byte === 0x0a) {
        // Enter — advance
        handled = true;
      } else if (byte === 0x65) {
        // 'e' — edit
        const editor = process.env["EDITOR"] || "vi";
        try {
          spawnSync(editor, [filePath], { stdio: "inherit" });
        } catch (err: unknown) {
          if (
            err instanceof Error &&
            "code" in err &&
            (err as NodeJS.ErrnoException).code === "ENOENT"
          ) {
            process.stderr.write(`Editor not found: ${editor}\n`);
            continue;
          }
          throw err;
        }
        handled = true;
      } else if (byte === 0x73) {
        // 's' — skip
        handled = true;
      }
      // Any other key: loop re-prompts
    }
  }

  // Additional notes prompt
  process.stdout.write("\nAdditional notes (leave blank to skip): ");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const line = await rl.question("");
  rl.close();

  const trimmed = line.trim();
  if (trimmed.length > 0) {
    const now = new Date().toISOString();
    const entry = `\n## Notes — ${now}\n${trimmed}\n`;
    await appendFile(join(specDir, "user-notes.md"), entry, "utf-8");
  }
}
