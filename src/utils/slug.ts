import fs from "fs";
import path from "path";

export function toSlug(title: string): string {
  let result = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (result.length > 50) {
    const truncated = result.slice(0, 50);
    const lastHyphen = truncated.lastIndexOf("-");
    result = lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
  }

  return result;
}

export async function resolveSlug(
  specsDir: string,
  slug: string,
): Promise<string> {
  let candidate = slug;
  let suffix = 2;

  while (await dirExists(path.join(specsDir, candidate))) {
    candidate = `${slug}-${suffix}`;
    suffix++;
  }

  return candidate;
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    await fs.promises.access(dirPath);
    return true;
  } catch {
    return false;
  }
}
