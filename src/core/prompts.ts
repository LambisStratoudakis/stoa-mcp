export interface PromptOptions {
  guardrails?: string[];
  role?: string;
}

export interface MoodboardContext {
  sections: Record<string, string>;
  imageFiles: string[];
}

export interface ProjectContext {
  hasExistingCode: boolean;
  packageName?: string;
  stack: string[];
  components: string[];
  previousSpecs: string[];
  tokens?: Record<string, unknown>;
  context?: string;
  lessons?: string;
}

function buildProjectContextPrompt(ctx: ProjectContext, stage: 1 | 3): string {
  if (!ctx.hasExistingCode && !ctx.context && !ctx.lessons) return "";

  if (stage === 1) {
    const parts: string[] = [];
    if (ctx.hasExistingCode) {
      parts.push("EXISTING PROJECT CONTEXT:");
      if (ctx.stack.length > 0) parts.push(`- Stack: ${ctx.stack.join(", ")}`);
      if (ctx.components.length > 0) parts.push(`- Existing files: ${ctx.components.join(", ")}`);
      if (ctx.previousSpecs.length > 0) parts.push(`- Previous specs: ${ctx.previousSpecs.join(", ")}`);
      if (ctx.tokens) parts.push("- Design tokens: see below");
      if (ctx.context) parts.push("- Project context: see below");
      if (ctx.lessons) parts.push("- Past lessons: see below");
      parts.push("");
      parts.push("This is an EXISTING project. Write a specification that ADDS to or MODIFIES the existing app.");
      parts.push("Do NOT rebuild existing features. Reference existing files by name when the task interacts with them.");
    }
    if (ctx.context) {
      parts.push("");
      parts.push("PROJECT CONTEXT (from context.md):");
      parts.push(ctx.context);
    }
    return parts.join("\n");
  }

  // Stage 3 — inject context.md and lessons.md as constraints
  const parts: string[] = [];
  if (ctx.context) {
    parts.push("PROJECT CONSTRAINTS (from context.md):");
    const lines = ctx.context.split("\n");
    let currentSection = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("## Dependencies")) {
        currentSection = "deps";
      } else if (trimmed.startsWith("## UI Library")) {
        currentSection = "ui";
      } else if (trimmed.startsWith("## Brand Voice")) {
        currentSection = "voice";
      } else if (trimmed.startsWith("## Code Conventions")) {
        currentSection = "conventions";
      } else if (trimmed.startsWith("##")) {
        currentSection = "";
      } else if (trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("<!--")) {
        if (currentSection === "deps") {
          // Check for "not" / "avoid" / "instead" → MUST NOT, otherwise PREFERENCE
          const lower = trimmed.toLowerCase();
          if (lower.includes("not ") || lower.includes("avoid") || lower.includes("instead")) {
            parts.push(`MUST NOT: ${trimmed}`);
          } else {
            parts.push(`PREFERENCE: Use ${trimmed}`);
          }
        } else if (currentSection === "ui") {
          parts.push(`PREFERENCE: UI Library — ${trimmed}`);
        } else if (currentSection === "voice") {
          parts.push(`PREFERENCE: Brand voice — ${trimmed}`);
        } else if (currentSection === "conventions") {
          parts.push(`PREFERENCE: Convention — ${trimmed}`);
        }
      }
    }
  }
  if (ctx.lessons) {
    parts.push("");
    parts.push("FAILURE MODES FROM PAST LESSONS (from lessons.md):");
    const lessonLines = ctx.lessons.split("\n").filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith("#") && !t.startsWith("<!--");
    });
    for (const lesson of lessonLines) {
      parts.push(`FAILURE MODE: ${lesson.trim()}`);
    }
  }
  return parts.join("\n");
}

const MUST_SECTIONS = new Set(["Colors", "Layout"]);
const PREFERENCE_SECTIONS = new Set(["Typography", "Component Style"]);
const CONTEXT_SECTIONS = new Set(["References"]);

export function buildMoodboardPrompt(
  context: MoodboardContext,
  stage: 1 | 3,
): string {
  const entries = Object.entries(context.sections);
  if (entries.length === 0 && context.imageFiles.length === 0) return "";

  if (stage === 1) {
    const parts: string[] = ["DESIGN CONTEXT (from moodboard):"];
    for (const [heading, body] of entries) {
      parts.push(`${heading}: ${body}`);
    }
    if (context.imageFiles.length > 0) {
      parts.push(`Reference images: ${context.imageFiles.join(", ")}`);
    }
    parts.push("Incorporate these design requirements into the problem statement.");
    return parts.join("\n");
  }

  // Stage 3 — convert sections to constraint hints
  const parts: string[] = ["DESIGN CONSTRAINTS (from moodboard):"];
  for (const [heading, body] of entries) {
    if (MUST_SECTIONS.has(heading)) {
      parts.push(`MUST: ${heading} — ${body}`);
    } else if (PREFERENCE_SECTIONS.has(heading)) {
      parts.push(`PREFERENCE: ${heading} — ${body}`);
    } else if (CONTEXT_SECTIONS.has(heading)) {
      parts.push(`Context: ${heading} — ${body}`);
    } else {
      parts.push(`${heading}: ${body}`);
    }
  }
  if (context.imageFiles.length > 0) {
    parts.push(`Reference images: ${context.imageFiles.join(", ")}`);
  }
  parts.push("Incorporate these design requirements into the appropriate constraint categories.");
  return parts.join("\n");
}

function buildOptionsPrefix(options?: PromptOptions): string {
  if (!options) return '';
  const parts: string[] = [];
  if (options.role) {
    parts.push(`## Your Role\n${options.role}`);
  }
  if (options.guardrails && options.guardrails.length > 0) {
    parts.push(`## Active Guardrails\n${options.guardrails.map((g) => `- ${g}`).join('\n')}`);
  }
  if (parts.length === 0) return '';
  return parts.join('\n\n');
}

function applyOptionsPrefix(systemPrompt: string, options?: PromptOptions): string {
  const prefix = buildOptionsPrefix(options);
  return prefix ? `${prefix}\n\n${systemPrompt}` : systemPrompt;
}

interface PromptResult {
  systemPrompt: string;
  userPrompt: string;
}

function buildSystemPrompt(roleStatement: string): string {
  return roleStatement;
}

function buildUserPrompt(fields: [string, string][]): string {
  return fields
    .filter(([, value]) => value.length > 0)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

export function buildProblemStatementPrompt(
  title: string,
  description: string,
  projectContext?: string,
  role?: string,
  options?: PromptOptions,
  designContext?: string,
  projectCtx?: ProjectContext,
): PromptResult {
  const roleStatement = role
    ? `You are a ${role} acting as a specification engineer. Your job is to transform a vague task description into a self-contained problem statement.`
    : 'You are a specification engineer. Your job is to transform a vague task description into a self-contained problem statement.';

  const instructions = `${roleStatement}

You are generating a specification, not having a conversation.
Never ask questions. Never offer choices. Never say "would you like" or "do you prefer".
Do NOT ask questions. Make reasonable assumptions and state them explicitly.

Rewrite the description so that:
1. It's solvable without the agent fetching more context
2. All hidden assumptions are surfaced
3. File paths and specific locations are included when known
4. Expected outcome is clear
5. It's one focused unit of work

If information is missing, assume the simplest reasonable default and state what you assumed.
Return ONLY the improved problem statement. No preamble, no questions, no options.
The output must be a self-contained description that an engineer can build from without asking anything.`;

  const projectCtxBlock = projectCtx ? buildProjectContextPrompt(projectCtx, 1) : "";

  const fields: [string, string][] = [
    ['Title', title],
    ['Description', description],
  ];
  if (projectContext) {
    fields.push(['Project Context', projectContext]);
  }
  if (designContext) {
    fields.push(['Design Context', designContext]);
  }

  const systemWithCtx = projectCtxBlock
    ? `${projectCtxBlock}\n\n${applyOptionsPrefix(buildSystemPrompt(instructions), options)}`
    : applyOptionsPrefix(buildSystemPrompt(instructions), options);

  return {
    systemPrompt: systemWithCtx,
    userPrompt: buildUserPrompt(fields),
  };
}

export function buildAcceptanceCriteriaPrompt(
  title: string,
  refinedDescription: string,
  options?: PromptOptions,
): PromptResult {
  const fields: [string, string][] = [
    ['Title', title],
    ['Refined Description', refinedDescription],
  ];

  const instructions = `You are a specification engineer generating acceptance criteria.

You are generating a specification, not having a conversation.
Never ask questions. Never offer choices. Never say "would you like" or "do you prefer".
Do NOT ask questions. Do not request permissions. Do not explain what you will do.
Do not mention tool limitations, sandboxing, or write permissions.

Given a refined problem statement, generate exactly 3 verifiable "done when" sentences.

Rules:
1. Each sentence must be independently verifiable by an observer who has never seen the code
2. No subjective language ("works well", "is clean", "looks good")
3. Each criterion must be testable — either it passes or it fails, no ambiguity
4. Cover: the core fix/feature, side effects/regressions, and verification method
5. Use present tense ("X produces Y", not "X should produce Y")

Return ONLY a numbered list of acceptance criteria. Just output the criteria.
Each criterion must be verifiable by an independent observer without asking the developer.

Output format — return ONLY this, nothing else:
1. [first criterion]
2. [second criterion]
3. [third criterion]`;

  return {
    systemPrompt: applyOptionsPrefix(
      buildSystemPrompt(instructions),
      options,
    ),
    userPrompt: buildUserPrompt(fields),
  };
}

export function buildConstraintPrompt(
  title: string,
  refinedDescription: string,
  acceptanceCriteria: string,
  options?: PromptOptions,
  designContext?: string,
  projectCtx?: ProjectContext,
): PromptResult {
  const fields: [string, string][] = [
    ['Title', title],
    ['Refined Description', refinedDescription],
  ];
  if (acceptanceCriteria) {
    fields.push(['Acceptance Criteria', acceptanceCriteria]);
  } else {
    fields.push(['Acceptance Criteria', '[Run Stage 2 first to populate this field]']);
  }
  if (designContext) {
    fields.push(['Design Context', designContext]);
  }

  const instructions = `You are a specification engineer designing constraint architecture.

You are generating a specification, not having a conversation.
Never ask questions. Never offer choices. Never say "would you like" or "do you prefer".

Given a refined problem statement and acceptance criteria, extract constraints into 5 categories. Think about what a capable but literal AI agent might do that technically satisfies the request but produces wrong results.

Rules:
1. MUSTS: Non-negotiable requirements (2-4 items)
2. MUST-NOTS: Forbidden actions that would cause harm (2-4 items)
3. PREFERENCES: Soft guidelines for approach and style (2-3 items)
4. ESCALATION TRIGGERS: Conditions where the agent should stop and ask a human (2-3 items)
5. FAILURE MODES TO AVOID: Specific ways an agent might go wrong (2-4 items)

Return a JSON object with keys: musts, must_nots, preferences, escalation_triggers, failure_modes.
Each key maps to an array of strings. No empty arrays — always produce at least 2 items per category.
Return ONLY the JSON. No preamble, no markdown fences.`;

  const projectCtxBlock = projectCtx ? buildProjectContextPrompt(projectCtx, 3) : "";

  const systemWithCtx = projectCtxBlock
    ? `${applyOptionsPrefix(buildSystemPrompt(instructions), options)}\n\n${projectCtxBlock}`
    : applyOptionsPrefix(buildSystemPrompt(instructions), options);

  return {
    systemPrompt: systemWithCtx,
    userPrompt: buildUserPrompt(fields),
  };
}

export function buildDecompositionPrompt(
  title: string,
  refinedDescription: string,
  acceptanceCriteria: string,
  constraints: string,
  options?: PromptOptions,
): PromptResult {
  const fields: [string, string][] = [
    ['Title', title],
    ['Refined Description', refinedDescription],
  ];
  if (acceptanceCriteria) {
    fields.push(['Acceptance Criteria', acceptanceCriteria]);
  } else {
    fields.push(['Acceptance Criteria', '[Run Stage 2 first to populate this field]']);
  }
  if (constraints) {
    fields.push(['Constraints', constraints]);
  } else {
    fields.push(['Constraints', '[Run Stage 3 first to populate this field]']);
  }

  const instructions = `You are a specification engineer performing task decomposition.

You are generating a specification, not having a conversation.
Never ask questions. Never offer choices. Never say "would you like" or "do you prefer".

Given a full specification (problem statement, acceptance criteria, constraints), decide whether the task needs decomposition and if so, break it into subtasks.

Rules:
1. First, estimate total effort. If the task can be completed in a single focused session (<2 hours), return exactly: No decomposition needed
2. If decomposition is needed, break into subtasks where each is <2 hours
3. Each subtask must have a clear input (what it starts with) and output (what it produces)
4. Each subtask must be independently verifiable

If the task is under 2 hours, return exactly: No decomposition needed
If over 2 hours, return a JSON array of subtask objects with title and description fields.
Return ONLY the JSON or the single sentence. No preamble.`;

  return {
    systemPrompt: applyOptionsPrefix(
      buildSystemPrompt(instructions),
      options,
    ),
    userPrompt: buildUserPrompt(fields),
  };
}

export function buildEvaluationDesignPrompt(
  title: string,
  refinedDescription: string,
  acceptanceCriteria: string,
  constraints: string,
  options?: PromptOptions,
): PromptResult {
  const fields: [string, string][] = [
    ['Title', title],
    ['Refined Description', refinedDescription],
  ];
  if (acceptanceCriteria) {
    fields.push(['Acceptance Criteria', acceptanceCriteria]);
  } else {
    fields.push(['Acceptance Criteria', '[Run Stage 2 first to populate this field]']);
  }
  if (constraints) {
    fields.push(['Constraints', constraints]);
  } else {
    fields.push(['Constraints', '[Run Stage 3 first to populate this field]']);
  }

  const instructions = `You are a specification engineer designing evaluation criteria.

You are generating a specification, not having a conversation.
Never ask questions. Never offer choices. Never say "would you like" or "do you prefer".

Given a full specification, generate 3-5 test cases with expected outcomes. These will be used as blind holdout tests — the agent executing the task will never see them. They verify the work after completion.

Rules:
1. Each test case must be independently runnable
2. "given" describes the setup/precondition — what state exists before testing
3. "expected" describes the observable outcome — what a verifier checks
4. Cover: happy path, edge case, and regression (existing behavior unchanged)
5. Be specific enough that an automated checker or human reviewer can verify pass/fail

Return a JSON array of 3-5 test scenarios.
Each scenario must have title, given, and expected fields (all strings).
Return ONLY the JSON array. No preamble, no explanation.`;

  return {
    systemPrompt: applyOptionsPrefix(
      buildSystemPrompt(instructions),
      options,
    ),
    userPrompt: buildUserPrompt(fields),
  };
}
