import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toSlug } from "../utils/slug.js";

function guardrailsDir(): string {
  return join(process.cwd(), ".stoa", "guardrails");
}

export function listGuardrails(): Array<{ slug: string; title: string }> {
  if (!existsSync(guardrailsDir())) return [];

  const files = readdirSync(guardrailsDir())
    .filter((f) => f.endsWith(".md"))
    .sort();

  return files.map((file) => {
    const slug = file.replace(/\.md$/, "");
    const content = readFileSync(join(guardrailsDir(), file), "utf-8");
    const firstLine = content.split("\n")[0] ?? "";
    const title = firstLine.replace(/^#\s*/, "");
    return { slug, title };
  });
}

export function addGuardrail(title: string): void {
  const slug = toSlug(title);
  const filePath = join(guardrailsDir(), `${slug}.md`);

  if (existsSync(filePath)) {
    throw new Error(`Guardrail already exists: ${slug}`);
  }

  mkdirSync(guardrailsDir(), { recursive: true });
  writeFileSync(filePath, `# ${title}\n`, "utf-8");
}

export function showGuardrail(slug: string): string {
  const filePath = join(guardrailsDir(), `${slug}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Guardrail not found: ${slug}`);
  }

  return readFileSync(filePath, "utf-8");
}

export function removeGuardrail(slug: string): void {
  const filePath = join(guardrailsDir(), `${slug}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Guardrail not found: ${slug}`);
  }

  unlinkSync(filePath);
}

export function loadAllGuardrails(): string {
  if (!existsSync(guardrailsDir())) return "";

  const files = readdirSync(guardrailsDir())
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) return "";

  return files
    .map((file) => readFileSync(join(guardrailsDir(), file), "utf-8"))
    .join("\n---\n");
}
