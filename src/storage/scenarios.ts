import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Scenario {
  title: string;
  given: string;
  expected: string;
}

export function scenarioPath(name: string): string {
  return join(process.cwd(), ".stoa", "scenarios", `${name}.json`);
}

export function listScenarios(name: string): Scenario[] {
  const filePath = scenarioPath(name);
  if (!existsSync(filePath)) return [];
  return JSON.parse(readFileSync(filePath, "utf-8")) as Scenario[];
}

export function showScenarios(name: string): Scenario[] {
  const filePath = scenarioPath(name);
  if (!existsSync(filePath)) {
    throw new Error(`Scenarios file not found: ${name}`);
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as Scenario[];
}

export function addScenario(name: string, scenario: Scenario): void {
  const scenarios = listScenarios(name);
  scenarios.push(scenario);
  saveScenarios(name, scenarios);
}

export function removeScenario(name: string, index: number): void {
  const scenarios = showScenarios(name);
  if (index < 0 || index >= scenarios.length) {
    throw new Error(`Index ${index} out of bounds (0..${scenarios.length - 1})`);
  }
  scenarios.splice(index, 1);
  saveScenarios(name, scenarios);
}

export function saveScenarios(name: string, scenarios: Scenario[]): void {
  const filePath = scenarioPath(name);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(scenarios), "utf-8");
}
