/**
 * Pure response parsers for AI output.
 * No I/O, no imports, no side effects.
 */

const PREAMBLE_PREFIXES: string[] = [
  "i'm sandboxed",
  "i'll write",
  "based on",
  "here's the",
  "here's",
  "here is",
  "let me",
  "i can see",
  "i notice",
  "looking at",
];

const HR_PATTERN: RegExp = /^(---+|\*\*\*+|___+)\s*$/;

export function stripPreamble(raw: string): string {
  const lines: string[] = raw.split('\n');
  let start = 0;

  while (start < lines.length) {
    const trimmed: string = lines[start].trim();
    if (trimmed === '') {
      start++;
      continue;
    }
    const lower: string = trimmed.toLowerCase();
    if (PREAMBLE_PREFIXES.some((p) => lower.startsWith(p))) {
      start++;
      continue;
    }
    if (HR_PATTERN.test(trimmed)) {
      start++;
      continue;
    }
    break;
  }

  return lines.slice(start).join('\n').trim();
}

export function parseAcceptanceCriteria(raw: string): string[] {
  const lines: string[] = raw.split('\n');
  const results: string[] = [];

  // Strategy 1: Look for DONE WHEN: prefix and extract numbered items after it
  const headerMatch: RegExpMatchArray | null = raw.match(/done when\s*:\s*/i);
  if (headerMatch && headerMatch.index !== undefined) {
    const afterHeader: string = raw.slice(headerMatch.index + headerMatch[0].length);
    const afterLines: string[] = afterHeader.split('\n');
    const itemPattern: RegExp = /^\d+\.\s+(.+)/;
    const sectionPattern: RegExp = /^[A-Z][A-Z _]+:?\s*$/;

    for (const line of afterLines) {
      const trimmed: string = line.trim();
      if (sectionPattern.test(trimmed) && !trimmed.toLowerCase().startsWith('done when')) break;
      const match: RegExpMatchArray | null = trimmed.match(itemPattern);
      if (match) {
        results.push(match[1].trim());
      }
    }
    if (results.length > 0) return results;
  }

  // Strategy 2: Match numbered lines, bullet lines, or DONE WHEN:-prefixed lines anywhere
  const linePattern: RegExp = /^(?:done when:\s*)?(?:\d+\.\s+|[-*•]\s+)(.+)/i;
  for (const line of lines) {
    const trimmed: string = line.trim();
    const match: RegExpMatchArray | null = trimmed.match(linePattern);
    if (match) {
      results.push(match[1].trim());
    }
  }
  if (results.length > 0) return results;

  // Strategy 3: Fallback — filter to only lines that look like criteria
  // (contain actionable language, not conversational filler)
  const conversationalPrefixes: string[] = [
    "it looks like",
    "it seems",
    "i can see",
    "i notice",
    "write permissions",
    "haven't been granted",
    "i'll need",
    "i would need",
    "let me",
    "unfortunately",
    "i'm unable",
    "i don't have",
  ];

  for (const line of lines) {
    const trimmed: string = line.trim();
    if (trimmed.length === 0) continue;
    const lower: string = trimmed.toLowerCase();
    const isConversational: boolean = conversationalPrefixes.some((p) => lower.startsWith(p));
    if (!isConversational) {
      results.push(trimmed);
    }
  }

  return results;
}

interface Constraints {
  musts: string[];
  must_nots: string[];
  preferences: string[];
  escalation_triggers: string[];
  failure_modes: string[];
}

const CONSTRAINT_SECTIONS: Array<{ labels: string[]; key: keyof Constraints }> = [
  { labels: ['musts'], key: 'musts' },
  { labels: ['must nots', 'must_nots'], key: 'must_nots' },
  { labels: ['preferences'], key: 'preferences' },
  { labels: ['escalation triggers', 'escalation_triggers'], key: 'escalation_triggers' },
  { labels: ['failure modes', 'failure_modes'], key: 'failure_modes' },
];

function buildSectionRegex(): RegExp {
  const allLabels: string[] = CONSTRAINT_SECTIONS.flatMap((s) => s.labels);
  const escaped: string = allLabels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^(${escaped})\\s*[:\\n]`, 'im');
}

function labelToKey(label: string): keyof Constraints {
  const lower: string = label.toLowerCase().trim();
  for (const section of CONSTRAINT_SECTIONS) {
    if (section.labels.includes(lower)) return section.key;
  }
  return 'musts';
}

const LIST_ITEM_PATTERN: RegExp = /^[-*\u2022]\s+(.+)|^\d+\.\s+(.+)/;

function hasAnyItems(c: Constraints): boolean {
  return c.musts.length > 0
    || c.must_nots.length > 0
    || c.preferences.length > 0
    || c.escalation_triggers.length > 0
    || c.failure_modes.length > 0;
}

function buildMarkdownHeaderRegex(): RegExp {
  const allLabels: string[] = CONSTRAINT_SECTIONS.flatMap((s) => s.labels);
  const escaped: string = allLabels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Matches: ## MUSTS, ### Must Nots, **MUSTS:**, **Must Nots:**
  return new RegExp(`^(?:#{1,4}\\s+(${escaped})|\\*\\*\\s*(${escaped})\\s*:?\\*\\*:?|\\*\\*(${escaped})\\*\\*:?)\\s*$`, 'i');
}

export function parseConstraints(raw: string): Constraints {
  const empty: Constraints = {
    musts: [],
    must_nots: [],
    preferences: [],
    escalation_triggers: [],
    failure_modes: [],
  };

  // Strategy 1: Try JSON.parse first
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const result: Constraints = { ...empty };
      for (const section of CONSTRAINT_SECTIONS) {
        for (const label of [section.key, ...section.labels]) {
          const val: unknown = obj[label];
          if (Array.isArray(val)) {
            result[section.key] = val.filter((v): v is string => typeof v === 'string');
            break;
          }
        }
      }
      if (hasAnyItems(result)) {
        // Check for double-wrapped JSON: musts contains a single string that is itself JSON
        if (
          result.musts.length === 1 &&
          result.must_nots.length === 0 &&
          result.preferences.length === 0 &&
          result.escalation_triggers.length === 0 &&
          result.failure_modes.length === 0
        ) {
          const inner = result.musts[0]
            .replace(/^```json\s*/, "")
            .replace(/\s*```$/, "")
            .trim();
          if (inner.startsWith("{")) {
            try {
              const innerParsed: unknown = JSON.parse(inner);
              if (typeof innerParsed === "object" && innerParsed !== null && !Array.isArray(innerParsed)) {
                const innerObj = innerParsed as Record<string, unknown>;
                const unwrapped: Constraints = { ...empty };
                for (const section of CONSTRAINT_SECTIONS) {
                  for (const label of [section.key, ...section.labels]) {
                    const val: unknown = innerObj[label];
                    if (Array.isArray(val)) {
                      unwrapped[section.key] = val.filter((v): v is string => typeof v === "string");
                      break;
                    }
                  }
                }
                if (hasAnyItems(unwrapped)) return unwrapped;
              }
            } catch {
              // Not valid inner JSON — use outer result
            }
          }
        }
        return result;
      }
    }
  } catch {
    // Not valid JSON — continue to next strategy
  }

  // Strategy 2: Plain-text section headers (existing logic + markdown header support)
  const result: Constraints = { ...empty };
  const sectionRegex: RegExp = buildSectionRegex();
  const mdHeaderRegex: RegExp = buildMarkdownHeaderRegex();
  const lines: string[] = raw.split('\n');
  let currentKey: keyof Constraints | null = null;

  for (const line of lines) {
    const trimmed: string = line.trim();

    // Check plain section header (e.g. "musts:" or "MUSTS\n")
    const headerMatch: RegExpMatchArray | null = trimmed.match(sectionRegex);
    if (headerMatch) {
      currentKey = labelToKey(headerMatch[1]);
      continue;
    }

    // Check markdown-style header (e.g. "## MUSTS", "**MUSTS:**", "### Must Nots")
    const mdMatch: RegExpMatchArray | null = trimmed.match(mdHeaderRegex);
    if (mdMatch) {
      const label: string = (mdMatch[1] || mdMatch[2] || mdMatch[3]).replace(/[*#:]/g, '').trim();
      currentKey = labelToKey(label);
      continue;
    }

    if (currentKey === null) continue;

    const itemMatch: RegExpMatchArray | null = trimmed.match(LIST_ITEM_PATTERN);
    if (itemMatch) {
      const text: string = (itemMatch[1] || itemMatch[2]).trim();
      result[currentKey].push(text);
    }
  }

  if (hasAnyItems(result)) return result;

  // Strategy 3: Fallback — wrap entire response as musts
  return { ...empty, musts: [raw.trim()] };
}

interface DecompositionItem {
  title: string;
  description: string;
  estimate: string;
  verify: string;
}

function findMatchingBracket(str: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < str.length; i++) {
    if (str[i] === '[') depth++;
    else if (str[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractFirstJsonArray(raw: string): unknown | null {
  const openIdx: number = raw.indexOf('[');
  if (openIdx === -1) return null;
  const closeIdx: number = findMatchingBracket(raw, openIdx);
  if (closeIdx === -1) return null;
  try {
    return JSON.parse(raw.slice(openIdx, closeIdx + 1));
  } catch {
    return null;
  }
}

function isDecompositionItem(obj: unknown): obj is DecompositionItem {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['title'] === 'string' &&
    typeof o['description'] === 'string' &&
    typeof o['estimate'] === 'string' &&
    typeof o['verify'] === 'string'
  );
}

export function parseDecomposition(raw: string): DecompositionItem[] | null {
  if (raw.toLowerCase().includes('no decomposition needed')) return null;

  const parsed: unknown = extractFirstJsonArray(raw);
  if (!Array.isArray(parsed)) return null;
  if (!parsed.every(isDecompositionItem)) return null;
  return parsed as DecompositionItem[];
}

interface ScenarioItem {
  title: string;
  given: string;
  expected: string;
}

function isScenarioItem(obj: unknown): obj is ScenarioItem {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['title'] === 'string' &&
    typeof o['given'] === 'string' &&
    typeof o['expected'] === 'string'
  );
}

export function parseScenarios(raw: string): ScenarioItem[] {
  const parsed: unknown = extractFirstJsonArray(raw);
  if (!Array.isArray(parsed)) return [];
  if (!parsed.every(isScenarioItem)) return [];
  return parsed as ScenarioItem[];
}
