# Invariant suite

Automated assertions against a **running Obsidian** for the standing behaviors that keep regressing at the platform boundary — the layer jsdom unit tests structurally cannot reach (real workspace focus, keymap scope stack, persisted plugin data on disk, startup ordering).

Runs over the obsidian CLI's CDP surface (`dev:cdp`), reusing the screenshot pipeline's `Cdp` wrapper. No plugin reload, no app restart — probes attach to the live instance.

## Usage

```bash
# Against a per-worktree smoke studio (the default smoke target)
npx tsx tools/invariant-suite/run.ts --vault ST-<worktree>

# Against the shared fixtures studio
npx tsx tools/invariant-suite/run.ts --vault studio

# Subset
npx tsx tools/invariant-suite/run.ts --vault studio --only INV-2,INV-4
```

Or via npm: `npm run invariants -- --vault ST-<worktree>`.

The target vault must already be open in Obsidian. The runner verifies the `vault=` scope actually landed (name round-trip) before probing.

## Safety

Some probes mutate disposable UI state (INV-1 opens a new chat tab). The runner **refuses any vault that is not `studio` or `ST-*`**. `--allow-vault` overrides — never use it against a working vault; live agent sessions must not be disturbed.

## Invariants

| Id | Asserts | Guards (regression class) |
|----|---------|---------------------------|
| INV-1 | Composer textarea holds focus after the new-chat command | focus-return class |
| INV-2 | Keymap scope returns to root scope on blur (no lingering chat-UI scopes) | scope-leak class |
| INV-3 | Saved-session index ⇔ disk artifacts ⇔ per-leaf tab slices all resolve | restore / session-store-split class |
| INV-4 | `getAvailableAgents()` is non-empty, unique, includes enabled custom agents and the default agent | picker/dropdown wiring class |
| INV-5 | Notification firing + click routing — **todo** (not probeable from renderer eval yet; covered by SF-6 human flow) | notification class |
| INV-6 | Quick-prompt chips all carry non-empty labels | cold-start label race |

Statuses: `pass` / `fail` / `skip` (precondition absent in this vault) / `todo` (probe not implemented). Only `fail` sets a non-zero exit code.

## When to run

Before each PR's human smoke test (after deploying the build to the smoke vault): the suite clears the mechanical invariants so the human pass spends its budget on UX judgment and the flow catalog (`Smoke Flows` SF-1…SF-9), not on re-verifying old mechanics.

## Adding an invariant

1. Add a probe to `lib/invariants.ts` implementing the `Invariant` interface. Keep it safe for disposable vaults; prefer read-only.
2. Map it to the regression class it guards (`guards` field) — an invariant without a shipped-regression rationale is probably a unit test in disguise.
3. Register it in the `invariants` array and this README's table.
