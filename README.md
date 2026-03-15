# stoa-mcp

**Turn one sentence into a full specification that makes any AI coding tool build what you actually want.**

Stoa is a specification compiler. You describe what you want in plain English. Stoa runs a 5-stage pipeline that turns it into a structured spec with design tokens, constraints, acceptance criteria, and test scenarios. Then you feed that spec to Lovable, Bolt, Cursor, Claude Code, v0 — any tool — and they all build the same thing.

The same prompt given to 5 different AI tools without a spec produces 5 completely different apps. With a Stoa spec, all 5 match your design.

---

## Install

```bash
npm install -g stoa-mcp
```

Requires Node.js 18 or higher.

---

## Quick Start (5 minutes)

### 1. Create a project

```bash
mkdir my-app && cd my-app
stoa init
```

This creates a `.stoa/` folder with everything Stoa needs:

```
.stoa/
  moodboard/notes.md    ← your design direction (colors, layout, style)
  context.md            ← dependencies, conventions, brand voice
  lessons.md            ← project memory (grows automatically)
  guardrails/           ← rules the AI must follow
  roles/                ← AI personas (Builder, Fixer, Planner)
  specs/                ← saved specifications
```

### 2. Set up your moodboard (optional but powerful)

Open the moodboard file:

```bash
stoa edit moodboard
```

Replace the template with your design preferences:

```markdown
# Design Direction
Minimal and dark like Linear

# Colors
Primary: #E8C872
Background: #1A1A1A
Text: #F5F5F5

# Layout
Sidebar navigation left, main content right

# Typography
Clean sans-serif, large headings
```

That's it. Four lines. Every spec you generate will include these design tokens.

**Have a screenshot of a design you like?** Drop it in `.stoa/moodboard/` and run:

```bash
stoa moodboard describe
```

If you have an Anthropic API key, Stoa will analyze the image and write the design system for you. If not, it prints a prompt you can paste into any Claude chat along with your screenshot.

### 3. Refine your idea

```bash
stoa refine "Personal finance tracker to log expenses and view spending by category"
```

Stoa runs 5 stages:

1. **Problem Statement** — expands your sentence into a full spec with data models, file structure, and design tokens from your moodboard
2. **Acceptance Criteria** — defines exactly what "done" means
3. **Constraints** — what the AI must do, must not do, and common mistakes to avoid
4. **Decomposition** — breaks big tasks into subtasks (or says "no decomposition needed")
5. **Scenarios** — generates test cases you can verify after the build

After refining, Stoa:
- Saves the spec as readable markdown files in `.stoa/specs/`
- Copies Stage 1 to your clipboard automatically
- Prints a build command you can use with Claude Code

```
Spec saved to .stoa/specs/personal-finance-tracker/
Score: 5/5 Executable

→ Stage 1 description copied to clipboard
  Paste into Lovable, Bolt, v0, or any AI tool

→ Build prompt for Claude Code:
  Read the spec in .stoa/specs/personal-finance-tracker/ and build it.

→ Scenarios saved. Run: stoa scenarios run
```

### 4. Build

**Option A — Paste into any AI tool:**

Open Lovable, Bolt, v0, or any AI coding tool. Press Cmd+V. The spec is already on your clipboard. The AI builds exactly what you specified.

**Option B — Use Claude Code:**

```bash
claude "Read the spec in .stoa/specs/personal-finance-tracker/ and build it. Follow all constraints and subtasks."
```

**Option C — Use Cursor with Claude Code extension:**

Open the project folder in Cursor. Open Claude Code from the sidebar. Paste the build prompt.

### 5. Verify

After the build, run through the test scenarios:

```bash
stoa scenarios run
```

Stoa walks you through each scenario one by one:

```
Scenario 1/5: Happy path — add expense and verify summary

  GIVEN:
  Add 3 expenses in different categories. Navigate to Dashboard.

  EXPECTED:
  Each category shows in the donut chart. Total matches the sum.

  Pass? [y/n/s(skip)] →
```

Open your app in the browser, do what GIVEN says, check if EXPECTED matches. Press `y` for pass, `n` for fail, `s` to skip.

At the end you get a summary:

```
Results: 4 passed, 1 failed, 0 skipped
Failed:
  - "Category filter shows correct subset"
```

If something failed, describe the issue to Claude Code and it will fix it.

---

## Adding Features to an Existing App

Stoa knows when code already exists. After the first build, run refine again:

```bash
stoa refine "Add monthly budget limits per category with progress bars on the dashboard"
```

Stage 1 will reference your existing files, components, and design system. The spec says "modify Dashboard.tsx" — not "build a finance tracker from scratch."

---

## Changing the Design

Update your moodboard, then refine:

```bash
stoa edit moodboard
# Change colors, layout, style...

stoa refine "Redesign the app to match the updated design system"
```

Stoa generates a migration spec — what changes, what stays, exact old-to-new token mapping.

---

## Project Context Files

All files in `.stoa/` are optional. Use what you need, ignore what you don't.

| File | What it does | Best for |
|------|-------------|----------|
| `moodboard/notes.md` | Design direction: colors, layout, typography | Web apps, UI projects |
| `moodboard/tokens.json` | Auto-generated machine-readable design values | Generated by `stoa moodboard sync` |
| `context.md` | Dependencies, conventions, brand voice | All projects |
| `lessons.md` | Past mistakes — auto-grows, prevents repeats | All projects (grows over time) |
| `guardrails/*.md` | Rules the AI must follow (e.g. "don't delete code") | All projects |
| `roles/*.md` | AI personas with different behaviors | Advanced usage |

### context.md

Open with `stoa edit context`. Add your stack preferences:

```markdown
# Project Context

## Brand Voice
Friendly but professional. Use "Save" not "Submit". Error messages explain what went wrong and what to do.

## Dependencies
Use date-fns for dates, not moment. Use HeroUI for all UI components. Use zustand for state management.

## UI Library
HeroUI (https://www.heroui.com) — buttons, inputs, cards, modals, tables

## Code Conventions
PascalCase for components. One component per file. Test files next to source files.
```

These get injected into every refine automatically. You never have to repeat "we use HeroUI" again.

### lessons.md

This file grows automatically. After a failed build, tell Claude Code:

> Add what we just fixed to .stoa/lessons.md

Example entry:

```markdown
## 2026-03-14: HeroUI + Tailwind v4 invisible components
**What happened:** HeroUI components rendered in the DOM but were invisible.
**Prevention:** Add @source "../node_modules/@heroui/theme/dist/**/*.js" to index.css after @import "tailwindcss".
```

Every future refine includes past lessons as failure modes to avoid. Your project gets smarter with every build.

---

## CLI Reference

```bash
# Setup
stoa init                        # Create .stoa/ folder with templates
stoa edit moodboard              # Open moodboard in your editor
stoa edit context                # Open context.md in your editor
stoa edit lessons                # Open lessons.md in your editor

# Moodboard
stoa moodboard sync              # Generate tokens.json from notes.md
stoa moodboard describe          # AI-analyze screenshots in moodboard/
stoa moodboard describe --overwrite  # Overwrite existing notes.md

# Refine
stoa refine "your task"          # Run 5-stage pipeline
stoa refine "task" --mode api    # Force API mode (needs API key)
stoa refine "task" --mode clipboard  # Get prompts without AI calls

# Specs
stoa specs list                  # List all saved specs
stoa specs show <name>           # View a spec's contents

# Scenarios
stoa scenarios list              # List scenarios for latest spec
stoa scenarios run               # Walk through scenarios interactively
stoa scenarios run <name>        # Run scenarios for a specific spec

# Guardrails & Roles
stoa guardrails list             # List active guardrails
stoa guardrails show <name>      # View a guardrail
stoa roles list                  # List available roles
stoa roles show <name>           # View a role

# Config
stoa config                      # View current config
stoa config set apiKey <key>     # Set Anthropic API key
stoa config set model <model>    # Set model (default: claude-sonnet-4-20250514)
stoa config set mode <mode>      # Set mode: api, claude-code, clipboard
```

---

## Execution Modes

Stoa has three ways to run the AI pipeline:

| Mode | How it works | You need |
|------|-------------|----------|
| `api` | Direct Anthropic API call | API key (`stoa config set apiKey`) |
| `claude-code` | Pipes to Claude Code CLI | Claude Code installed + subscription |
| `clipboard` | Returns prompts — no AI calls | Nothing (free) |

Stoa auto-detects: if you have an API key it uses `api`, if Claude Code is installed it uses `claude-code`, otherwise `clipboard`.

In clipboard mode, Stoa prints each stage's prompt. You paste it into any AI chat (Claude, ChatGPT, Cursor) and copy the response back. Everything works — just manually.

---

## Use with Cursor (MCP)

Add Stoa as an MCP server in Cursor. Create or edit `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "stoa": {
      "command": "node",
      "args": ["/path/to/global/node_modules/stoa-mcp/dist/index.js"]
    }
  }
}
```

Find the global path with:

```bash
npm root -g
```

Then in Cursor's Agent chat:

```
Use the refine_task tool with title: "My App" and description: "description of what I want"
```

---

## How It Works

### The 5-Stage Pipeline

**Stage 1: Problem Statement** — Takes your one-sentence idea and expands it into a complete specification. Includes data models, file structure, CLI/API interface, design tokens (from your moodboard), and explicit assumptions.

**Stage 2: Acceptance Criteria** — Generates 3 verifiable "done when" conditions. Each is specific enough that you can test it in a browser or terminal.

**Stage 3: Constraints** — Produces four categories:
- **MUSTs** — non-negotiable requirements
- **MUST NOTs** — things to avoid (wrong libraries, anti-patterns)
- **Preferences** — nice-to-haves from your context.md
- **Failure Modes** — common mistakes to watch for (including lessons.md)

**Stage 4: Decomposition** — Breaks complex tasks into ordered subtasks, or says "no decomposition needed" for small tasks.

**Stage 5: Scenarios** — Generates GIVEN/EXPECTED test cases. These are blind tests — the AI that builds your app never sees them. You verify after the build.

### Project Awareness

When you run `stoa refine` in a project that already has code, Stoa scans:
- `package.json` — knows your stack (React, Vue, Tailwind, etc.)
- `src/` directory — knows your existing components
- `.stoa/specs/` — knows what's been built before
- Moodboard — knows your design system
- `context.md` — knows your dependencies and conventions
- `lessons.md` — knows past mistakes to avoid

The spec references existing files by name and says "add to" instead of "rebuild."

---

## Starter Templates

`stoa init` ships with:

**5 Guardrails:**
- `explain-changes` — AI explains what it changed and why
- `dont-delete-code` — don't remove existing code without explicit request
- `ask-when-unclear` — stop and ask instead of guessing
- `run-tests` — run tests after changes
- `small-changes` — make focused, small changes

**3 Roles:**
- `Builder` — writes new features
- `Fixer` — fixes bugs from failure context
- `Planner` — breaks down large tasks

---

## The Stoa Desktop App

The CLI is the free version. The full loop lives in the Stoa desktop app:

- Visual 5-stage refine with Accept/Edit/Skip per stage
- One-click build with Claude Code integration
- Blind test verification with auto-fix loop
- Session tracking with WIP snapshots
- Task hierarchy (parent → subtask → fix task)
- Dashboard with spec scores across all tasks

**Same pipeline, full GUI.** Coming soon at [stoafactory.com](https://stoafactory.com).

---

## License

MIT
