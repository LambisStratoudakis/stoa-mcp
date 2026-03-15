import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HEX_STANDALONE_RE = /#[0-9A-Fa-f]{6}\b/g;

interface TokensResult {
  colors?: Record<string, string>;
  typography?: Record<string, string>;
  layout?: Record<string, string>;
  style?: Record<string, string>;
  framework?: Record<string, string | null>;
  references?: string;
}

// Known section names — used for bare-line matching (no # prefix)
const KNOWN_SECTIONS = new Set([
  "Design Direction",
  "Colors",
  "Layout",
  "Typography",
  "Component Style",
  "References",
  "UI Library",
  "Images",
]);

function parseSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = raw.split("\n");
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = (): void => {
    if (currentHeading) {
      const body = currentBody
        .join("\n")
        .replace(HTML_COMMENT_RE, "")
        .trim();
      if (body.length > 0) {
        sections[currentHeading] = body;
      }
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Match "# Heading" or "## Heading"
    const mdMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (mdMatch) {
      flush();
      currentHeading = mdMatch[1].trim();
      currentBody = [];
      continue;
    }

    // Match bare section name on its own line (e.g. "Colors" without #)
    if (KNOWN_SECTIONS.has(trimmed)) {
      flush();
      currentHeading = trimmed;
      currentBody = [];
      continue;
    }

    // Also match "**Section Name**", "**Section Name:**", "**Section Name**:"
    const boldMatch = trimmed.match(/^\*\*(.+?):?\*\*:?\s*$/);
    if (boldMatch && KNOWN_SECTIONS.has(boldMatch[1].trim())) {
      flush();
      currentHeading = boldMatch[1].trim();
      currentBody = [];
      continue;
    }

    if (currentHeading !== null) {
      currentBody.push(line);
    }
  }

  flush();
  return sections;
}

function extractColors(text: string): Record<string, string> | undefined {
  const colors: Record<string, string> = {};

  // Process line by line for maximum flexibility
  const lines = text.split("\n");
  for (const line of lines) {
    // Strip markdown cruft: bullets, bold markers, leading dashes
    const cleaned = line
      .replace(/^[-*•]\s+/, "")     // bullet prefix
      .replace(/\*\*/g, "")          // bold markers
      .replace(/^\d+\.\s+/, "")      // numbered list
      .trim();

    if (cleaned.length === 0) continue;

    // Match: "Label: #HEXVAL" with optional trailing text
    // Handles: "Primary: #E8C872", "Background color: #1A1A1A (dark)", "Text: #F5F5F5 — used for headings"
    const labelHexMatch = cleaned.match(/^([A-Za-z][A-Za-z0-9 /]*?)\s*:\s*(#[0-9A-Fa-f]{6})\b/);
    if (labelHexMatch) {
      const label = labelHexMatch[1]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      colors[label] = labelHexMatch[2];
      continue;
    }

    // Match: "#HEXVAL (label)" or "#HEXVAL - label"
    const hexLabelMatch = cleaned.match(/(#[0-9A-Fa-f]{6})\s*[-—(]\s*([A-Za-z][A-Za-z0-9 ]*)/);
    if (hexLabelMatch) {
      const label = hexLabelMatch[2]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      colors[label] = hexLabelMatch[1];
    }
  }

  if (Object.keys(colors).length > 0) return colors;

  // Fallback: collect standalone hex values
  const hexMatches = text.match(HEX_STANDALONE_RE);
  if (hexMatches && hexMatches.length > 0) {
    for (let i = 0; i < hexMatches.length; i++) {
      colors[`color_${i + 1}`] = hexMatches[i];
    }
    return colors;
  }

  return undefined;
}

function extractTypography(text: string): Record<string, string> | undefined {
  const typo: Record<string, string> = {};

  // Look for font family mentions
  const fontMatch = text.match(/(?:font[- ]?family|font):\s*(.+)/i);
  if (fontMatch) {
    typo.fontFamily = fontMatch[1].trim();
  }

  // Look for size mentions
  const sizeMatch = text.match(/(?:size|font[- ]?size):\s*(.+)/i);
  if (sizeMatch) {
    typo.fontSize = sizeMatch[1].trim();
  }

  // If no structured data but there's content, store the whole thing
  if (Object.keys(typo).length === 0 && text.trim().length > 0) {
    typo.fontFamily = text.trim().split("\n")[0];
  }

  return Object.keys(typo).length > 0 ? typo : undefined;
}

function extractLayout(text: string): Record<string, string> | undefined {
  if (text.trim().length === 0) return undefined;
  return { structure: text.trim() };
}

function extractStyle(text: string): Record<string, string> | undefined {
  const style: Record<string, string> = {};

  const radiusMatch = text.match(/border[- ]?radius:\s*(.+)/i);
  if (radiusMatch) style.borderRadius = radiusMatch[1].trim();

  const shadowMatch = text.match(/shadow[s]?:\s*(.+)/i);
  if (shadowMatch) style.shadows = shadowMatch[1].trim();

  // If no structured data but there's content, store as description
  if (Object.keys(style).length === 0 && text.trim().length > 0) {
    style.description = text.trim();
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function extractFramework(text: string): Record<string, string | null> | undefined {
  // Look for UI library mention
  const uiMatch = text.match(/(?:^|\n)(.+?)(?:\s*\(|\s*[-—]\s*|\s*:)/);
  if (uiMatch) {
    const urlMatch = text.match(/https?:\/\/[^\s)]+/);
    return {
      ui: uiMatch[1].trim(),
      ...(urlMatch ? { url: urlMatch[0] } : {}),
    };
  }

  if (text.trim().length > 0) {
    return { ui: text.trim().split("\n")[0] };
  }

  return undefined;
}

export function syncMoodboard(dir: string): TokensResult {
  const notesPath = join(dir, ".stoa", "moodboard", "notes.md");

  if (!existsSync(notesPath)) {
    throw new Error("No moodboard/notes.md found. Run 'stoa init' first.");
  }

  const raw = readFileSync(notesPath, "utf-8");
  const sections = parseSections(raw);

  const tokens: TokensResult = {};

  if (sections["Colors"]) {
    const colors = extractColors(sections["Colors"]);
    if (colors) tokens.colors = colors;
  }

  if (sections["Typography"]) {
    const typo = extractTypography(sections["Typography"]);
    if (typo) tokens.typography = typo;
  }

  if (sections["Layout"]) {
    const layout = extractLayout(sections["Layout"]);
    if (layout) tokens.layout = layout;
  }

  if (sections["Component Style"]) {
    const style = extractStyle(sections["Component Style"]);
    if (style) tokens.style = style;
  }

  if (sections["References"]) {
    tokens.references = sections["References"];
  }

  // Check for UI Library section (may be standalone or inside References)
  if (sections["UI Library"]) {
    const framework = extractFramework(sections["UI Library"]);
    if (framework) tokens.framework = framework;
  }

  const tokensPath = join(dir, ".stoa", "moodboard", "tokens.json");
  writeFileSync(tokensPath, JSON.stringify(tokens, null, 2) + "\n", "utf-8");

  return tokens;
}
