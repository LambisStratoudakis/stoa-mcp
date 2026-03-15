import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { syncMoodboard } from "./moodboard-sync.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_IMAGES = 20;

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const ANALYSIS_PROMPT = `Look at this UI screenshot carefully.

1. COLORS — List every distinct color you see. For each one:
   - Approximate hex value
   - Where it appears (e.g. "page background", "primary button fill", "heading text")
   Format each as: "Role: #HEXVAL"

2. LAYOUT — Describe the page structure:
   - Navigation position and type
   - Content area layout (grid, single column, sidebar+main)
   - Approximate proportions

3. TYPOGRAPHY — What you can observe:
   - Font style (sans-serif, serif, monospace)
   - Relative sizes for headings vs body
   - Say "sans-serif" unless the font is clearly identifiable

4. COMPONENT STYLE — What you see:
   - Card style (bordered? shadowed? rounded?)
   - Button style (filled? outlined? rounded?)
   - Input style if visible
   - Spacing density (compact, normal, spacious)

5. OVERALL FEEL — One sentence. Name a known app if it resembles one.

Return ONLY a markdown document with these exact section headings. No other text:

# Design Direction
(one sentence)

# Colors
(list each as "Role: #HEXVAL")

# Layout
(description)

# Typography
(description)

# Component Style
(description)

# References
(name the app or style this resembles)

Only describe what is VISIBLE. Do not invent colors that aren't on screen.`;

const MULTI_IMAGE_PREFIX = `Analyze these UI screenshots together. They represent the same design system. Extract a unified design system from all images combined.\n\n`;

function getImageFiles(moodboardDir: string): string[] {
  const entries = readdirSync(moodboardDir);
  return entries
    .filter((f) => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort();
}

function hasUserContent(notesPath: string): boolean {
  if (!existsSync(notesPath)) return false;
  const content = readFileSync(notesPath, "utf-8");
  const stripped = content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#.*$/gm, "")
    .trim();
  return stripped.length > 0;
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const TYPED_MEDIA: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function buildImageContent(
  moodboardDir: string,
  imageFiles: string[],
): Anthropic.ImageBlockParam[] {
  return imageFiles.map((file) => {
    const filePath = join(moodboardDir, file);
    const data = readFileSync(filePath).toString("base64");
    const ext = extname(file).toLowerCase();
    const mediaType: ImageMediaType = TYPED_MEDIA[ext] || "image/png";
    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: mediaType,
        data,
      },
    };
  });
}

function loadModel(): string {
  try {
    const configPath = join(process.cwd(), ".stoa", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config.model || "claude-sonnet-4-6";
  } catch {
    return "claude-sonnet-4-6";
  }
}

export interface DescribeOptions {
  mode: "api" | "claude-code" | "clipboard";
  overwrite?: boolean;
  apiKey?: string;
  onConfirm?: () => Promise<boolean>;
}

export interface DescribeResult {
  mode: "api" | "claude-code" | "clipboard";
  output: string;
  imageCount: number;
  written: boolean;
}

export async function describeMoodboard(
  dir: string,
  options: DescribeOptions,
): Promise<DescribeResult> {
  const moodboardDir = join(dir, ".stoa", "moodboard");

  if (!existsSync(moodboardDir)) {
    throw new Error("No .stoa/moodboard/ directory. Run 'stoa init' first.");
  }

  const imageFiles = getImageFiles(moodboardDir);

  if (imageFiles.length === 0) {
    throw new Error("No images in .stoa/moodboard/. Drop a screenshot and try again.");
  }

  if (imageFiles.length > MAX_IMAGES) {
    throw new Error(`Too many images (${imageFiles.length}). Maximum is ${MAX_IMAGES}.`);
  }

  const prompt = imageFiles.length > 1
    ? MULTI_IMAGE_PREFIX + ANALYSIS_PROMPT
    : ANALYSIS_PROMPT;

  // claude-code and clipboard modes: print the prompt for manual use
  if (options.mode === "clipboard" || options.mode === "claude-code") {
    const modeLabel = options.mode === "claude-code"
      ? "Claude Code CLI doesn't support image input."
      : "Image analysis requires API mode.";

    const output = [
      modeLabel,
      "",
      "Paste your screenshot(s) into Claude chat with this prompt:",
      "",
      "---",
      prompt,
      "---",
      "",
      `Then save Claude's response as .stoa/moodboard/notes.md`,
      `Run 'stoa moodboard sync' to generate tokens.json`,
    ].join("\n");

    return { mode: options.mode, output, imageCount: imageFiles.length, written: false };
  }

  // API mode
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No API key found. Set ANTHROPIC_API_KEY or run: stoa config set apiKey sk-ant-...",
    );
  }

  const notesPath = join(moodboardDir, "notes.md");

  // Check for existing content — ask to overwrite unless --overwrite
  if (!options.overwrite && hasUserContent(notesPath)) {
    if (options.onConfirm) {
      const confirmed = await options.onConfirm();
      if (!confirmed) {
        return { mode: "api", output: "Cancelled.", imageCount: imageFiles.length, written: false };
      }
    }
  }

  const model = loadModel();
  const client = new Anthropic({ apiKey });

  const imageContent = buildImageContent(moodboardDir, imageFiles);
  const promptBlock: Anthropic.TextBlockParam = { type: "text", text: prompt };
  const content: Anthropic.ContentBlockParam[] = [...imageContent, promptBlock];

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  const output = textBlock?.text ?? "";

  if (!output.trim()) {
    throw new Error("API returned empty response.");
  }

  // Write notes.md
  writeFileSync(notesPath, output + "\n", "utf-8");

  // Auto-sync tokens
  try {
    syncMoodboard(dir);
  } catch {
    // Non-critical
  }

  return { mode: "api", output, imageCount: imageFiles.length, written: true };
}
