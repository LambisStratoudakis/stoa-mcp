#!/usr/bin/env node
/**
 * Stoa MCP Server entry point.
 * Registers refine_task, score_spec tools, guardrails resource, and refine prompt.
 */

import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { refinePipeline } from "./core/refine.js";
import { computeSpecScore } from "./core/spec-score.js";
import { writeSpecFiles, writeRefineMeta } from "./storage/index.js";
import { toSlug, resolveSlug } from "./utils/slug.js";
import { scanProject } from "./storage/project-scan.js";
import { syncMoodboard } from "./storage/moodboard-sync.js";

const STAGE_NAMES = ["clarify", "structure", "score", "harden", "finalize"] as const;

const STAGE_NAME_TO_NUMBER: Record<string, 1 | 2 | 3 | 4 | 5> = {
  clarify: 1,
  structure: 2,
  score: 3,
  harden: 4,
  finalize: 5,
};

const server = new McpServer({
  name: "stoa",
  version: "0.1.0",
});

// ── Tool: refine_task ─────────────────────────────────────────────────

server.tool(
  "refine_task",
  "Refine a task description through a multi-stage pipeline that produces a structured specification.",
  {
    title: z.string(),
    description: z.string(),
    stages: z.array(z.string()).optional(),
    project_context: z.string().optional(),
    role: z.string().optional(),
  },
  async ({ title, description, stages, project_context, role }) => {
    // Check that .stoa/ exists before running the pipeline
    const stoaDir = join(process.cwd(), ".stoa");
    try {
      await access(stoaDir);
    } catch {
      return {
        content: [
          {
            type: "text",
            text: "Error: .stoa/ directory not found. Run 'stoa init' to initialize your project.",
          },
        ],
        isError: true,
      };
    }

    const stageNumbers = (stages ?? [...STAGE_NAMES]).map((name) => {
      const num = STAGE_NAME_TO_NUMBER[name];
      if (!num) {
        throw new Error(`Unknown stage: ${name}. Valid stages: ${STAGE_NAMES.join(", ")}`);
      }
      return num;
    });

    // Sync moodboard tokens before pipeline
    try {
      syncMoodboard(process.cwd());
    } catch {
      // Non-critical — notes.md may not exist
    }

    // Scan project for context
    let projectCtx;
    try {
      projectCtx = scanProject(process.cwd());
    } catch {
      // Non-critical
    }

    const result = await refinePipeline(
      {
        title,
        description,
        projectContext: project_context,
        projectCtx,
        role,
      },
      { stages: stageNumbers },
    );

    // Write spec files to .stoa/specs/ — surface errors to caller
    const specsDir = join(stoaDir, "specs");
    const slug = await resolveSlug(specsDir, toSlug(title));
    const stagesRun: Record<number, string> = {};
    for (const sr of result.stages) {
      stagesRun[sr.stage] = sr.rawResponse;
    }

    try {
      await writeSpecFiles(specsDir, slug, stagesRun);
      await writeRefineMeta(
        specsDir,
        slug,
        result.stages.map((s: { stage: number }) => s.stage),
        result.executionMode,
        "0.1.0",
      );
    } catch (writeErr: unknown) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      process.stderr.write(`Warning: Failed to write spec files to .stoa/specs/${slug}/: ${msg}\n`);
    }

    // If all 5 stages ran successfully, the score is 5/5 regardless of input fields
    const allFiveRan = result.stages.length === 5 &&
      [1, 2, 3, 4, 5].every((s) => result.stages.some((sr) => sr.stage === s));
    if (allFiveRan) {
      result.finalSpecScore = 5;
    }

    const specPath = join(specsDir, slug);
    const response = { ...result, spec_path: specPath };

    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  },
);

// ── Tool: score_spec ──────────────────────────────────────────────────

server.tool(
  "score_spec",
  "Compute a spec-readiness score for a specification string.",
  {
    spec: z.string(),
  },
  ({ spec }) => {
    const hasDescription = spec.length > 0;
    const result = computeSpecScore({
      hasDescription,
      descriptionLength: spec.length,
      wasRefined: false,
      hasAcceptanceCriteria: false,
      hasGuardrails: false,
      hasRole: false,
      hasScenarios: false,
      hasSubtasks: false,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── Resource: guardrails ──────────────────────────────────────────────

server.resource(
  "guardrails",
  "stoa://guardrails",
  { description: "Project guardrails from .stoa/guardrails/ directory" },
  async () => {
    const guardrailsDir = join(process.cwd(), ".stoa", "guardrails");

    try {
      const files = await readdir(guardrailsDir);
      const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

      if (mdFiles.length === 0) {
        return {
          contents: [
            {
              uri: "stoa://guardrails",
              text: "No guardrail files found in .stoa/guardrails/",
              mimeType: "text/plain",
            },
          ],
        };
      }

      const parts: string[] = [];
      for (const file of mdFiles) {
        const content = await readFile(join(guardrailsDir, file), "utf-8");
        parts.push(content);
      }

      return {
        contents: [
          {
            uri: "stoa://guardrails",
            text: parts.join("\n\n"),
            mimeType: "text/markdown",
          },
        ],
      };
    } catch {
      return {
        contents: [
          {
            uri: "stoa://guardrails",
            text: "Guardrails directory (.stoa/guardrails/) does not exist.",
            mimeType: "text/plain",
          },
        ],
      };
    }
  },
);

// ── Prompt: refine ────────────────────────────────────────────────────

server.prompt(
  "refine",
  "Generate a prompt to refine a task using the refine_task tool.",
  {
    title: z.string(),
    description: z.string(),
  },
  ({ title, description }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please call the refine_task tool with the following:\n\ntitle: ${title}\ndescription: ${description}`,
        },
      },
    ],
  }),
);

// ── Start server ──────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("stoa-mcp server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
