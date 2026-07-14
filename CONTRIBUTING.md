# Contributing to Agent Console

Thank you for your interest in contributing to Agent Console! It's an Obsidian plugin built on the [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol), forked from [RAIT-09/obsidian-agent-client](https://github.com/RAIT-09/obsidian-agent-client) and maintained as a separate plugin focused on tabbed multi-session UX for parallel agent work.

## Before You Start

### Please Open an Issue First

**For significant changes, please open an issue before writing code:**

- New features
- Architecture changes
- Adding or modifying external dependencies
- Implementing draft/experimental ACP specifications

This helps ensure alignment with the project direction and saves time for both contributors and maintainers.

**You can submit a PR directly for:**

- Obvious bug fixes (typos, crashes, etc.)
- Fixes for existing issues
- Documentation improvements

### Project Scope

This plugin focuses on **ACP client implementation**, **tabbed multi-session UX for parallel agent work**, and **features that make ACP convenient to use in Obsidian**.

**In scope:**

- ACP protocol implementation
- Note mentions (`@[[note]]` to pass note content to agents)
- Obsidian-specific UI integration

**Out of scope:**

- Features achievable via standard protocols like MCP (these should be provided as MCP servers for a consistent experience across all agents)
- Agent-specific features (these should be handled via agent-specific config files, e.g., `.claude/` directory)

## Development Setup

### Prerequisites

- Node.js 18.x or later
- npm

### Setup Steps

```bash
# Navigate to your vault's plugins directory
cd /path/to/your/vault/.obsidian/plugins

# Clone the repository as "agent-console"
# The directory name must match the id in manifest.json
git clone https://github.com/donivatamazondotcom/obsidian-agent-console.git agent-console
cd agent-console

# Install dependencies
npm install

# Start development build (watch mode)
npm run dev
```

### Testing in Obsidian

1. After cloning to `.obsidian/plugins/agent-console`, run `npm run dev`
2. Enable the plugin in Obsidian Settings → Community Plugins
3. Code changes trigger automatic rebuilds, but you need to reload the plugin (toggle it off/on in Community Plugins) to see changes

## Available Commands

| Command             | Description                                      |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Development build (watch mode)                   |
| `npm run build`     | Production build (includes TypeScript type check)|
| `npm run lint`      | Run ESLint                                       |
| `npm run lint:fix`  | Run ESLint with auto-fix                         |
| `npm run format`    | Format code with Prettier                        |
| `npm run format:check` | Check formatting (used in CI)                 |

## Code Style

### Prettier Configuration

| Setting        | Value         |
| -------------- | ------------- |
| Indentation    | Tabs (width 4)|
| Semicolons     | Yes           |
| Quotes         | Double        |
| Trailing comma | All           |
| Print width    | 80            |
| End of line    | LF            |

### ESLint

We use `eslint-plugin-obsidianmd` for Obsidian-specific rules, `typescript-eslint` for TypeScript, and `eslint-plugin-jsx-a11y` for keyboard-accessibility rules on React components (`.tsx`). Every interactive element must be operable by keyboard alone — an `onClick` needs a keyboard handler, and custom (non-`<button>`) controls need `role` + `tabIndex`. See AGENTS.md -> Development Rules -> Accessibility.

### Obsidian Plugin Guidelines

1. **No innerHTML/outerHTML** — Use `createEl`, `createDiv`, `createSpan`
2. **Don't detach leaves in onunload** — This is an anti-pattern
3. **Styles in CSS only** — No JS style manipulation
4. **Use Platform API** — Don't use `process.platform`
5. **Minimize `any`** — Use proper types

### Cross-Platform (macOS, Windows, Linux)

Agent Console ships on all three desktop platforms. Keep platform specifics out of shared code:

- **Keyboard hints** — never hardcode Mac glyphs (⌘ ⌥ ⇧). Route key/modifier labels through `MOD_KEY` / `ALT_KEY` / `SHIFT_KEY` / `modCombo` in `utils/platform.ts` so Windows/Linux render `Ctrl` / `Alt` / `Shift`. A CI ESLint rule fails the build on a hardcoded glyph in a user-facing string.
- **Paths and shells** — use the helpers in `utils/platform.ts` (WSL, cmd.exe, login-shell); don't assume macOS paths or `/bin/zsh`.
- **Copy** — don't assume macOS in UI text, menu paths, or examples.

### File Naming Conventions

- **Types**: `kebab-case.ts` in `types/`
- **ACP**: `kebab-case.ts` in `acp/`
- **Services**: `kebab-case.ts` in `services/`
- **Hooks**: `use*.ts` in `hooks/`
- **Components**: `PascalCase.tsx` in `ui/`
- **Utilities**: `kebab-case.ts` in `utils/`

## Network Egress Policy

Agent Console's only outbound network calls are **best-effort version checks** — the plugin self-update check (GitHub Releases API) and the built-in agent npm version check (npm registry). None of these carry vault or conversation data. Everything else flows to the agent process you configure over a local stdio pipe (ACP), never to a third party.

To keep that guarantee auditable, **all network egress is centralised in `src/services/net.ts`** and enforced in CI:

1. **`net.ts` is the only module allowed to make network calls.** It exposes `fetchJson()` and a fixed `ALLOWED_HOSTS` list. A new endpoint means extending `ALLOWED_HOSTS` here and documenting why in this section.
2. **A tripwire test** (`src/__tests__/no-unsanctioned-network.test.ts`, run via `npm test`) fails the PR if `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`, Obsidian's `requestUrl`, or a node `http`/`https`/`net`/`tls`/`dgram` import appears anywhere under `src/` outside `net.ts`.
3. **`CODEOWNERS` + the `dependency-review` CI job** require maintainer review on every PR and surface new/changed dependencies, covering the human-approval and transitive-dependency vectors that a source-only scan can't.

This is defense-in-depth, not an absolute control — it catches accidental introductions and makes the "only two GETs" claim enforceable. **If your change needs to reach the network, route it through `net.ts` and open an issue first** so the new endpoint can be reviewed.

## Branch Naming

```
{username}/{type}/{description}
```

**Types:**

- `feature/` — New feature
- `fix/` — Bug fix
- `refactor/` — Refactoring
- `docs/` — Documentation
- `hotfix/` — Urgent fix

**Examples:**

- `yourname/feature/add-export`
- `yourname/fix/message-rendering`

## Commit Messages

We recommend [Conventional Commits](https://www.conventionalcommits.org/) style:

```
<type>: <description>

<optional body>
```

**Types:**

- `feat:` — New feature
- `fix:` — Bug fix
- `refactor:` — Refactoring
- `docs:` — Documentation
- `chore:` — Build/dependencies
- `style:` — Formatting (no functional changes)

## Pull Request Process

### Workflow

1. Create a branch from `main`
   - `main` is the default branch — both feature work and hotfixes target it
2. Make your changes and commit
3. Create a pull request
4. Ensure CI passes (lint, build)
5. Wait for review

### PR Checklist

Before submitting, please verify:

- [ ] `npm run lint` passes
- [ ] New interactive UI is keyboard-accessible (passes `jsx-a11y` rules)
- [ ] `npm run build` passes
- [ ] Tested in Obsidian
- [ ] Existing functionality still works
- [ ] Documentation updated if needed
- [ ] No new network egress outside `src/services/net.ts` (`npm test` passes the egress tripwire)

### Test quality rubric

Tests exist to fail when the code is wrong. A test that would pass against broken code manufactures false confidence. Every PR that adds or modifies tests must satisfy all five gates (or state N/A with a reason):

| # | Gate | What it means |
|---|---|---|
| R1 | **Red-first** | The test demonstrably fails against the pre-fix/pre-feature code. For bug fixes, cite the failing output. |
| R2 | **Boundary honesty** | The test enters at the seam the runtime uses — the real send path, mount→persist→remount lifecycle, or the public hook API — never a private helper when a live path exists. |
| R3 | **Outcome assertion** | Assert the user-visible or persisted outcome (rendered text, disk state, emitted event) — never only that a mock was called or that nothing threw. |
| R4 | **Mock budget** | Mock only at architecture boundaries (the `acp/` port, the settings port, the Obsidian stub). Mocking a sibling module of the code under test defeats the test. |
| R5 | **No tautology** | The test must not re-implement the production logic to compute its expected value. |

### CI

Pull requests automatically run:

- ESLint (`npx eslint src/`)
- Build (`npm run build`)
- Test (`npm test`) — includes the network-egress tripwire
- Dependency review (pull requests only)

Please ensure these pass locally before submitting.

**Note:** "Use sentence case for UI text" lint errors are acceptable for brand names and proper nouns (e.g., "Claude Code", "Gemini CLI").

## Architecture Overview

```
src/
├── types/          # Pure type definitions (no logic, no dependencies)
├── acp/            # ACP protocol layer (SDK confined here)
├── services/       # Non-React business logic + pure functions
├── hooks/          # React custom hooks (useAgent facade + sub-hooks)
├── ui/             # React components (ChatPanel orchestrator)
└── utils/          # Shared utility functions
```

### Architecture Principles

1. **useAgent as facade** — Composes useAgentSession + useAgentMessages. Single `onSessionUpdate` subscription.
2. **Services have zero React imports** — Pure functions and classes in `services/`
3. **ACP isolation** — All `@agentclientprotocol/sdk` imports confined to `acp/`
4. **Types have zero deps** — No `obsidian`, no SDK, no React in `types/`
5. **Single event channel** — All agent events flow through `onSessionUpdate`. No special callback paths.

For more details, see `ARCHITECTURE.md`.

## ACP Notes

- Prioritize implementations that conform to the official (stable) ACP specification
- If implementing draft/experimental specs, please discuss in an issue first
- Implementations should work with official ACP-compatible agents (e.g., `@agentclientprotocol/claude-agent-acp`)

## Releasing

For maintainers cutting a new version, see [RELEASING.md](./RELEASING.md). Releases are automated via GitHub Actions on tag push.

## Questions?

Open an issue if you have any questions!
