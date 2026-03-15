import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  formatDescription,
  formatAcceptanceCriteria,
  formatConstraints,
  formatSubtasks,
  formatScenarios,
} from "./stage-formatters.js";

// --- formatDescription ---

test("formatDescription normalizes whitespace", () => {
  const raw = "\n\nBuild a REST API that handles user authentication.\n\n\n\nIt should support OAuth2.\n\n\n";
  const result = formatDescription(raw);
  assert.equal(result, "Build a REST API that handles user authentication.\n\nIt should support OAuth2.");
});

test("formatDescription handles empty input", () => {
  assert.equal(formatDescription(""), "No description provided.");
  assert.equal(formatDescription("   "), "No description provided.");
});

// --- formatAcceptanceCriteria ---

test("formatAcceptanceCriteria parses numbered list", () => {
  const raw = "1. Users can log in\n2. Users can log out\n3. Sessions expire after 30 min";
  const result = formatAcceptanceCriteria(raw);
  assert.equal(result, "1. Users can log in\n2. Users can log out\n3. Sessions expire after 30 min");
});

test("formatAcceptanceCriteria parses bullet list", () => {
  const raw = "- Users can log in\n- Users can log out";
  const result = formatAcceptanceCriteria(raw);
  assert.equal(result, "1. Users can log in\n2. Users can log out");
});

test("formatAcceptanceCriteria splits prose into sentences", () => {
  const raw = "The system should validate emails. Passwords must be at least 8 characters. Users receive a confirmation email.";
  const result = formatAcceptanceCriteria(raw);
  assert.ok(result.startsWith("1. "));
  assert.ok(result.includes("2. "));
  assert.ok(result.includes("3. "));
});

test("formatAcceptanceCriteria handles empty input", () => {
  const result = formatAcceptanceCriteria("");
  assert.ok(result.includes("1."));
});

// --- formatConstraints ---

test("formatConstraints classifies MUSTS and MUST-NOTS", () => {
  const raw = "Must use TypeScript. Must not use any external dependencies. Avoid global state. Should support ESM only.";
  const result = formatConstraints(raw);
  assert.ok(result.includes("## MUSTS"));
  assert.ok(result.includes("## MUST-NOTS"));
  assert.ok(result.includes("- Must use TypeScript."));
  assert.ok(result.includes("- Must not use any external dependencies."));
  assert.ok(result.includes("- Avoid global state."));
});

test("formatConstraints handles no must-nots", () => {
  const raw = "Use TypeScript. Support ESM.";
  const result = formatConstraints(raw);
  assert.ok(result.includes("## MUST-NOTS"));
  assert.ok(result.includes("- None specified."));
});

test("formatConstraints handles empty input", () => {
  const result = formatConstraints("");
  assert.ok(result.includes("## MUSTS"));
  assert.ok(result.includes("## MUST-NOTS"));
});

// --- formatSubtasks ---

test("formatSubtasks produces task list", () => {
  const raw = "1. Set up project structure\n2. Implement auth module\n3. Write tests";
  const result = formatSubtasks(raw);
  assert.ok(result.includes("- [ ] Set up project structure"));
  assert.ok(result.includes("- [ ] Implement auth module"));
  assert.ok(result.includes("- [ ] Write tests"));
});

test("formatSubtasks detects no decomposition", () => {
  assert.equal(formatSubtasks("No decomposition needed for this task."), "No decomposition needed.");
  assert.equal(formatSubtasks("This is a single task."), "No decomposition needed.");
});

test("formatSubtasks handles empty input", () => {
  assert.equal(formatSubtasks(""), "No decomposition needed.");
});

// --- formatScenarios ---

test("formatScenarios parses given/when/then", () => {
  const raw = "Given a user is logged in When they click logout Then they are redirected to the login page";
  const result = formatScenarios(raw);
  assert.ok(result.includes("**Scenario 1**"));
  assert.ok(result.includes("GIVEN:"));
  assert.ok(result.includes("EXPECTED:"));
});

test("formatScenarios parses GIVEN/EXPECTED style", () => {
  const raw = "GIVEN a valid API key EXPECTED the request succeeds with 200";
  const result = formatScenarios(raw);
  assert.ok(result.includes("**Scenario 1**"));
  assert.ok(result.includes("GIVEN: a valid API key"));
  assert.ok(result.includes("EXPECTED: the request succeeds with 200"));
});

test("formatScenarios handles empty input", () => {
  const result = formatScenarios("");
  assert.ok(result.includes("**Scenario 1**"));
  assert.ok(result.includes("GIVEN:"));
  assert.ok(result.includes("EXPECTED:"));
});

test("formatScenarios handles multiple scenarios", () => {
  const raw = "GIVEN valid input EXPECTED success\nGIVEN invalid input EXPECTED error message";
  const result = formatScenarios(raw);
  assert.ok(result.includes("**Scenario 1**"));
  assert.ok(result.includes("**Scenario 2**"));
});

test("all formatters are pure - same input yields same output", () => {
  const input = "Test input string. Another sentence.";
  assert.equal(formatDescription(input), formatDescription(input));
  assert.equal(formatAcceptanceCriteria(input), formatAcceptanceCriteria(input));
  assert.equal(formatConstraints(input), formatConstraints(input));
  assert.equal(formatSubtasks(input), formatSubtasks(input));
  assert.equal(formatScenarios(input), formatScenarios(input));
});
