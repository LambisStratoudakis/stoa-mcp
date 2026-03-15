import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toSlug } from "../utils/slug.js";

function rolesDir(): string {
  return join(process.cwd(), ".stoa", "roles");
}

export function listRoles(): string[] {
  if (!existsSync(rolesDir())) return [];

  return readdirSync(rolesDir())
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => f.replace(/\.md$/, ""));
}

export function addRole(displayName: string): void {
  const slug = toSlug(displayName);
  const filePath = join(rolesDir(), `${slug}.md`);

  if (existsSync(filePath)) {
    throw new Error(`Role already exists: ${slug}`);
  }

  mkdirSync(rolesDir(), { recursive: true });
  writeFileSync(filePath, `# ${displayName}\n\nYou are a ${displayName}.\n`, "utf-8");
}

export function showRole(slug: string): string {
  const filePath = join(rolesDir(), `${slug}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Role not found: ${slug}`);
  }

  return readFileSync(filePath, "utf-8");
}

export function removeRole(slug: string): void {
  const filePath = join(rolesDir(), `${slug}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Role not found: ${slug}`);
  }

  unlinkSync(filePath);
}

export function loadRole(slug: string): string {
  return showRole(slug);
}
