export interface SpecScoreInput {
  hasDescription: boolean;
  descriptionLength: number;
  wasRefined: boolean;
  hasAcceptanceCriteria: boolean;
  hasGuardrails: boolean;
  hasRole: boolean;
  hasScenarios: boolean;
  hasSubtasks: boolean;
}

export interface SpecScoreResult {
  score: number;
  level: string;
  missing: string[];
}

const DESCRIPTION_LENGTH_THRESHOLD = 100;

export function computeSpecScore(input: SpecScoreInput): SpecScoreResult {
  const hasAdequateLength = input.descriptionLength >= DESCRIPTION_LENGTH_THRESHOLD;

  // Determine current level
  let score: number;
  let level: string;

  if (!input.hasDescription) {
    score = 0;
    level = "Empty";
  } else if (!hasAdequateLength || !input.wasRefined) {
    score = 1;
    level = "Basic";
  } else if (!input.hasAcceptanceCriteria || !input.hasGuardrails) {
    score = 2;
    level = "Described";
  } else if (!input.hasRole || !input.hasScenarios) {
    score = 3;
    level = "Constrained";
  } else if (!input.hasSubtasks) {
    score = 4;
    level = "Specified";
  } else {
    return { score: 5, level: "Executable", missing: [] };
  }

  // Collect only the missing items needed to advance to the next level
  const missing: string[] = [];

  if (score === 0) {
    missing.push("description");
  }
  if (score === 1) {
    if (!hasAdequateLength) missing.push("detailed description (100+ characters)");
    if (!input.wasRefined) missing.push("refinement pass");
  }
  if (score === 2) {
    if (!input.hasAcceptanceCriteria) missing.push("acceptance criteria");
    if (!input.hasGuardrails) missing.push("guardrails");
  }
  if (score === 3) {
    if (!input.hasRole) missing.push("role assignment");
    if (!input.hasScenarios) missing.push("scenarios");
  }
  if (score === 4) {
    if (!input.hasSubtasks) missing.push("subtasks");
  }

  return { score, level, missing };
}
