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
  moodboard/tokens.json  ← auto-generated machine-readable design tokens
  context.md            ← dependencies, conventions, brand voice
  lessons.md            ← project memory (grows automatically)
  guardrails/           ← rules the AI must follow
  roles/                ← AI personas (Builder, Fixer, Planner)
  presets/              ← your saved custom style presets
  specs/                ← saved specifications
```

Every new project starts with the **Clean** style preset (white, minimal, Linear-style). Every spec you generate will include these design tokens automatically.

### 2. Set up your moodboard (optional but powerful)

Your project already has a working design system. Check it:

```bash
stoa moodboard
```

**Want a different style?** Pick a preset:

```bash
stoa moodboard preset
```

Use arrow keys to browse 4 built-in presets with live previews:
- **Clean** — White, minimal, Linear/Vercel style
- **Dark** — Dark background, muted accents, GitHub/Raycast style
- **Warm** — Cream tones, friendly SaaS feel
- **Bold** — High contrast, sharp corners, brutalist

Or apply directly: `stoa moodboard preset dark`

**Want to customize?** Edit interactively in the terminal:

```bash
stoa moodboard edit
```

Walks you through each field (colors, typography, layout) one by one. Press Enter to keep, type a new value to change, or `q` to quit anytime.

**Have a screenshot of a design you like?** Run:

```bash
stoa moodboard describe
```

This opens the moodboard folder in Finder — drop your screenshots in, press Enter. If you have an Anthropic API key, Stoa analyzes the images and writes the design system for you. If not, it prints a prompt you can paste into any Claude chat.

**Save your custom style** for reuse across projects:

```bash
stoa moodboard save-preset my-brand
```

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
- Shows an interactive menu:

```
Spec saved to .stoa/specs/personal-finance-tracker/
Spec Score: 5 / 5

→ Stage 1 description copied to clipboard
  Paste into Lovable, Bolt, v0, or any AI tool

What next?
  [b] Build with Claude Code
  [c] Copy spec to clipboard
  [e] Export as single markdown
  [v] View spec files
  [q] Done
```

- **[b] Build** — launches Claude Code with the spec pre-loaded
- **[c] Copy** — re-copies the full spec to clipboard (useful if you copied something else)
- **[e] Export** — writes all 5 stages as a single markdown to `specs/<slug>/spec.md` in your project root (visible, not hidden inside `.stoa/`)
- **[v] View** — opens the spec directory in Finder
- **[q] Done** — exits

### 4. Build

**Option A — Press [b] after refine:**

The fastest path. Press `b` in the post-refine menu and Claude Code starts building immediately.

**Option B — Paste into any AI tool:**

Open Lovable, Bolt, v0, or any AI coding tool. Press Cmd+V. The spec is already on your clipboard. The AI builds exactly what you specified.

**Option C — Use Claude Code manually:**

```bash
claude "Read the spec in .stoa/specs/personal-finance-tracker/ and build it. Follow all constraints and subtasks."
```

**Option D — Use Cursor with Claude Code extension:**

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

Switch preset, edit interactively, or both:

```bash
stoa moodboard preset dark       # switch to dark theme
stoa moodboard edit              # tweak individual values
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
| `presets/*.json` | Custom saved style presets | Reuse across projects |
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

### Setup

```bash
stoa init
```
Creates `.stoa/` in the current directory with the Clean style preset, 5 guardrails, and 3 roles. Run this once per project.

```bash
stoa edit moodboard          # open moodboard in VS Code/Cursor
stoa edit context             # open context.md
stoa edit lessons             # open lessons.md
```
Opens files in the best available editor. Detection order: Cursor → VS Code → `$EDITOR` → macOS default → nano.

---

### Moodboard

```bash
stoa moodboard
```
Shows current moodboard status: active style, color count, image count, and available commands.

```bash
stoa moodboard preset
```
**Interactive.** Browse 4 built-in presets (Clean, Dark, Warm, Bold) + any custom presets with arrow keys. Shows a live preview with colors, typography, and references. Press **Enter** to apply, **q** to cancel.

You can also apply directly without the picker:
```bash
stoa moodboard preset dark
```

```bash
stoa moodboard edit
```
**Interactive.** Walks through each field one by one: Design Direction → Colors (each individually) → Typography → Layout → Component Style → References. Press **Enter** to keep current value. Type a new value to replace. Type **q** to quit at any point.

```bash
stoa moodboard describe
```
**Interactive.** Opens the `.stoa/moodboard/` folder in Finder so you can drag screenshots in. Press **Enter** when ready. If you have an API key, Stoa analyzes the images with AI and writes the design system automatically. Without an API key, it prints a prompt you can paste into any Claude chat alongside your screenshot.

```bash
stoa moodboard sync
```
Regenerates `tokens.json` from `notes.md`. Usually happens automatically after preset or edit, but run this if you edited `notes.md` by hand.

```bash
stoa moodboard save-preset my-brand
```
Saves the current moodboard as `.stoa/presets/my-brand.json`. Reusable across projects — shows up in `stoa moodboard preset` picker.

---

### Refine

```bash
stoa refine "Build a waitlist page with email signup and referral system"
```
Runs the 5-stage pipeline. After completion, shows an interactive menu:

| Key | Action | Notes |
|-----|--------|-------|
| **b** | Build with Claude Code | Launches Claude Code with the spec |
| **c** | Copy spec to clipboard | Re-copy (Stage 1 is auto-copied on finish) |
| **e** | Export as markdown | Writes to `specs/<slug>/spec.md` in project root |
| **v** | View spec files | Opens spec directory in Finder |
| **q** | Done | Exits |

**Options:**
```bash
stoa refine "task" --mode api         # Force Anthropic API (needs key)
stoa refine "task" --mode claude-code # Force Claude Code CLI
stoa refine "task" --mode clipboard   # Get prompts without AI calls (free)
stoa refine "task" --role planner     # Use a specific role
stoa refine "task" --stages clarify,structure  # Run specific stages only
```

---

### Specs

```bash
stoa specs list                # List all saved specs with dates and stage count
stoa specs show <name>         # Print a spec's contents to terminal
```

Specs are saved in `.stoa/specs/<slug>/` with one markdown file per stage. The `[e]` export writes a combined `spec.md` to the visible `specs/` folder in your project root.

---

### Scenarios

```bash
stoa scenarios list              # List scenarios for the latest spec
stoa scenarios list <name>       # List scenarios for a specific spec
stoa scenarios run               # Walk through scenarios interactively
stoa scenarios run <name>        # Run scenarios for a specific spec
```

**Interactive.** Each scenario shows GIVEN (what to set up) and EXPECTED (what to check). Press **y** for pass, **n** for fail, **s** to skip. Shows a summary at the end.

---

### Review

```bash
stoa review                    # Review the latest spec
stoa review <name>             # Review a specific spec
```

**Interactive.** Opens each stage for review. Accept, edit, or skip. After editing, optionally re-runs affected pipeline stages.

---

### Build & Verify

```bash
stoa build                     # Build the latest spec with Claude Code
stoa build <name>              # Build a specific spec
stoa verify                    # Run blind test verification
stoa verify <name>             # Verify a specific spec
```

Build gives you a choice: build all at once or subtask by subtask. Verify runs the scenarios interactively after the build.

---

### Guardrails & Roles

```bash
stoa guardrails list           # List active guardrails
stoa guardrails show <name>    # View a guardrail's content
stoa guardrails add <name>     # Add a new guardrail
stoa guardrails remove <name>  # Remove a guardrail
stoa roles list                # List available roles
stoa roles show <name>         # View a role's content
stoa roles add <name>          # Add a new role
stoa roles remove <name>       # Remove a role
```

Guardrails are rules injected into every refine (e.g. "don't delete existing code"). Roles are AI personas used via `--role` flag.

---

### Config

```bash
stoa config                      # View current settings
stoa config set apiKey <key>     # Set Anthropic API key
stoa config set model <model>    # Set model (default: claude-sonnet-4-6)
stoa config set mode <mode>      # Set default mode: api, claude-code, clipboard
```

---

## Execution Modes

| Mode | How it works | You need | Cost |
|------|-------------|----------|------|
| `api` | Direct Anthropic API call | API key (`stoa config set apiKey`) | ~$0.05/refine |
| `claude-code` | Pipes to Claude Code CLI | Claude Code installed + subscription | Included in subscription |
| `clipboard` | Returns prompts — no AI calls | Nothing | Free |

Stoa auto-detects: API key → `api`, Claude Code in PATH → `claude-code`, otherwise → `clipboard`.

In clipboard mode, Stoa prints each stage's prompt. Paste into any AI chat (Claude, ChatGPT, Cursor) and copy the response back. Same pipeline, just manual.

---

## Keyboard Shortcuts

All interactive commands support these:

| Context | Key | Action |
|---------|-----|--------|
| Any prompt | `q` / `quit` / `exit` | Cancel and go back |
| Arrow key menus | `↑` `↓` or `k` `j` | Navigate |
| Arrow key menus | `Enter` | Select |
| Arrow key menus | `q` | Cancel |
| Post-refine menu | `b` `c` `e` `v` `q` | See table above |
| Scenario runner | `y` `n` `s` | Pass / Fail / Skip |
| Ctrl+C | Always | Force quit |

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

Find the global path:
```bash
echo "$(npm root -g)/stoa-mcp/dist/index.js"
```

Then in Cursor's Agent chat:
```
Use the refine_task tool with title: "My App" and description: "description of what I want"
```

## Use with Claude Code

Stoa works directly with Claude Code. After refining:

1. Press `[b]` in the post-refine menu — launches Claude Code automatically
2. Or copy the spec and paste it: `claude "Read the spec in .stoa/specs/<name>/ and build it"`
3. Or use `stoa build` for the full guided experience

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

**4 Style Presets:**
- `Clean` — white, minimal, Linear/Vercel (applied by default)
- `Dark` — dark background, violet accents, GitHub/Raycast
- `Warm` — cream tones, amber accents, Cal.com/Stripe
- `Bold` — high contrast, sharp corners, brutalist

---

## The Stoa Desktop App

The CLI is the free version. The full loop lives in the Stoa desktop app:

- Visual 5-stage refine with Accept/Edit/Skip per stage
- One-click build with Claude Code integration
- Blind test verification with auto-fix loop
- Session tracking with WIP snapshots
- Task hierarchy (parent → subtask → fix task)
- Dashboard with spec scores across all tasks

**Same pipeline, full GUI.** Coming soon at [stoafactory.com](https://stoafactory.dev).

---

## License

MIT
