import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

const FRAMEWORK_DETECTORS: Record<string, string> = {
  react: "React",
  "react-dom": "React",
  next: "Next.js",
  vue: "Vue",
  svelte: "Svelte",
  vite: "Vite",
  "@angular/core": "Angular",
  nuxt: "Nuxt",
};

const STYLE_DETECTORS: Record<string, string> = {
  tailwindcss: "Tailwind",
  "styled-components": "styled-components",
  "@emotion/react": "Emotion",
  sass: "Sass",
};

function detectStack(deps: Record<string, string>): string[] {
  const stack: string[] = [];

  for (const [pkg, label] of Object.entries(FRAMEWORK_DETECTORS)) {
    if (deps[pkg]) {
      const version = deps[pkg].replace(/[\^~>=<]/g, "").split(".")[0];
      stack.push(version ? `${label} ${version}` : label);
    }
  }

  for (const [pkg, label] of Object.entries(STYLE_DETECTORS)) {
    if (deps[pkg]) {
      stack.push(label);
    }
  }

  return stack;
}

function readFileSafe(path: string): string | undefined {
  try {
    const content = readFileSync(path, "utf-8").trim();
    // Strip HTML comments and check if there's real content
    const stripped = content.replace(/<!--[\s\S]*?-->/g, "").replace(/^#.*$/gm, "").trim();
    return stripped.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

export function scanProject(dir: string): ProjectContext {
  const context: ProjectContext = {
    hasExistingCode: false,
    stack: [],
    components: [],
    previousSpecs: [],
  };

  // Check package.json
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      context.packageName = pkg.name;
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      context.stack = detectStack(allDeps);

      // TypeScript detection
      if (allDeps["typescript"] || existsSync(join(dir, "tsconfig.json"))) {
        context.stack.push("TypeScript");
      }
    } catch {
      // Invalid package.json — skip
    }
  }

  // Scan src/ or app/ (1 level deep)
  for (const srcDir of ["src", "app"]) {
    const srcPath = join(dir, srcDir);
    if (existsSync(srcPath)) {
      try {
        const entries = readdirSync(srcPath);
        const codeFiles = entries.filter((f) =>
          /\.(ts|tsx|js|jsx|vue|svelte)$/.test(f),
        );
        context.components.push(...codeFiles);
      } catch {
        // Permission error or not a directory — skip
      }
    }
  }

  context.hasExistingCode = context.components.length > 0 || existsSync(pkgPath);

  // Check for previous specs
  const specsDir = join(dir, ".stoa", "specs");
  if (existsSync(specsDir)) {
    try {
      const specDirs = readdirSync(specsDir).filter((entry) => {
        try {
          return readdirSync(join(specsDir, entry)).length > 0;
        } catch {
          return false;
        }
      });
      context.previousSpecs = specDirs;
    } catch {
      // No specs dir — skip
    }
  }

  // Read tokens.json
  const tokensPath = join(dir, ".stoa", "moodboard", "tokens.json");
  if (existsSync(tokensPath)) {
    try {
      context.tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
    } catch {
      // Invalid JSON — skip
    }
  }

  // Read context.md (merged brand voice + dependencies + conventions)
  context.context = readFileSafe(join(dir, ".stoa", "context.md"));
  // Read lessons.md (separate — auto-grows)
  context.lessons = readFileSafe(join(dir, ".stoa", "lessons.md"));

  return context;
}
