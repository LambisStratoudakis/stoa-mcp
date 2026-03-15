/**
 * Pure markdown formatters for the 5 Refine Pipeline stages.
 * No side effects, no I/O, no external dependencies.
 */

function normalizeWhitespace(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\t ]+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function splitIntoItems(raw: string): string[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  const listItems: string[] = [];
  const listPattern = /^(?:\d+[\.\)]\s*|-\s*|\*\s*)/;

  if (lines.some((l) => listPattern.test(l))) {
    let current = "";
    for (const line of lines) {
      if (listPattern.test(line)) {
        if (current) listItems.push(current);
        current = line.replace(listPattern, "").trim();
      } else {
        current += " " + line;
      }
    }
    if (current) listItems.push(current);
  }

  if (listItems.length > 0) return listItems;

  // Prose: split on sentence boundaries
  const text = lines.join(" ");
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return sentences.length > 0 ? sentences : [text];
}

export function formatDescription(raw: string): string {
  if (!raw || !raw.trim()) return "No description provided.";
  return normalizeWhitespace(raw);
}

export function formatAcceptanceCriteria(raw: string): string {
  if (!raw || !raw.trim()) return "1. No acceptance criteria specified.";

  const items = splitIntoItems(raw);
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

export function formatConstraints(raw: string): string {
  if (!raw || !raw.trim()) {
    return "## MUSTS\n\n- None specified.\n\n## MUST-NOTS\n\n- None specified.";
  }

  const items = splitIntoItems(raw);
  const mustNotPattern = /\b(must\s+not|never|avoid|do\s+not|don['']t|shall\s+not|cannot|can['']t)\b/i;

  const musts: string[] = [];
  const mustNots: string[] = [];

  for (const item of items) {
    if (mustNotPattern.test(item)) {
      mustNots.push(item);
    } else {
      musts.push(item);
    }
  }

  const mustsSection = musts.length > 0
    ? musts.map((m) => `- ${m}`).join("\n")
    : "- None specified.";

  const mustNotsSection = mustNots.length > 0
    ? mustNots.map((m) => `- ${m}`).join("\n")
    : "- None specified.";

  return `## MUSTS\n\n${mustsSection}\n\n## MUST-NOTS\n\n${mustNotsSection}`;
}

export function formatSubtasks(raw: string): string {
  if (!raw || !raw.trim()) return "No decomposition needed.";

  const noDecompPattern = /\b(no\s+decomposition|single\s+task|not\s+needed|no\s+subtasks)\b/i;
  if (noDecompPattern.test(raw)) return "No decomposition needed.";

  const items = splitIntoItems(raw);
  if (items.length === 0) return "No decomposition needed.";

  return items.map((item) => `- [ ] ${item}`).join("\n");
}

export function formatScenarios(raw: string): string {
  if (!raw || !raw.trim()) {
    return "[]";
  }
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}
