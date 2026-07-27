/**
 * Bot-parity ESLint config — predicts the Obsidian store's automated review.
 *
 * This is NOT a code-quality config. Its single job is to reproduce what the
 * community.obsidian.md review bot reports, so a "Caution" label never again
 * surprises us minutes after a clean `npm run lint`. See
 * [[Agent Console Review-Bot Parity Gate]] for the full rationale.
 *
 * Three deliberate differences from `eslint.config.mjs` — each one is a blind
 * spot that let the v2.2.0 scorecard through with 33 findings:
 *
 *  1. NO `tools/**` carve-out. `eslint.config.mjs` turns every obsidianmd rule
 *     off for `tools/**` on the reasoning that Node tooling isn't renderer code.
 *     That reasoning is sound for code quality and irrelevant to parity: the bot
 *     scans the whole repository, not the shipped bundle, and reported 29
 *     findings in that tree. Note the console class is produced by an
 *     obsidianmd-namespaced rule (`obsidianmd/rule-custom-message`, which wraps
 *     core `no-console` with Obsidian's own message text) — so the carve-out
 *     switched it off, which is precisely why local lint reported zero.
 *  2. NO `token-efficiency.ts` ignore. That one file carried 16 of the 23
 *     console findings while being fully invisible to local lint.
 *  3. Only obsidianmd's recommended ruleset — none of the repo's own opinionated
 *     rules (the I115 menu / I134 platform restricted-syntax guards, the ACP
 *     import boundary, the saveSession single-writer ban, jsx-a11y,
 *     switch-exhaustiveness). Those are OUR rules; the bot never reports them,
 *     so including them would manufacture deltas that mean nothing about the
 *     store verdict. Parity is descriptive, code quality is prescriptive (D1).
 *
 * WARNINGS COUNT (D4). "Caution" is produced by warnings and recommendations,
 * not errors — the precise reason the old `0 errors` gate was blind. The runner
 * (`tools/quality-gates/run-bot-parity-gate.ts`) therefore reports every
 * severity; do not add `--quiet` anywhere in this path.
 *
 * ── Calibration, each backed by the v2.2.0 scorecard ──────────────────────
 *
 * The v2.2.0 scorecard's 33 findings account for exactly: 29 in `tools/**` (23
 * console + 6 `prefer-window-timers`), 2 eslint-reachable in shipped source
 * (`no-global-this`, `prefer-setting-definitions`), plus the `:has()` CSS lint
 * and the `sharp` advisory, which no eslint pass can produce. Two classes this
 * config would otherwise report are therefore established NOT to be bot
 * findings, and are calibrated out here rather than papered over in the
 * exception list:
 *
 *  A. `.mjs` / `.js` are out of the bot's scan surface. All six `tools/**\/*.mjs`
 *     files existed at the v2.2.0 tag and carry 31 console findings between
 *     them. Had the bot scanned them the scorecard would have read ~64, not 33.
 *     So the surface is `.ts`/`.tsx`. This is a scan-surface fact, expressed as
 *     scope — NOT 31 exception entries that would need editing on every new
 *     line of tooling output. RISK: if the bot ever widens to `.mjs` we are
 *     blind again, and only the Layer 3 dashboard preview scan would catch it.
 *     Tracked as an open question in the spec.
 *  B. `no-undef` is off for TypeScript. obsidianmd's recommended set enables
 *     typescript-eslint's `eslint-recommended` (which disables `no-undef` for
 *     TS, because TS resolves identifiers itself and the rule cannot see
 *     type-only ones) and then re-enables `no-undef: "warn"` in a later
 *     file-less override, which wins on ordering. The result flags `React` in a
 *     `.tsx` type position and `BufferEncoding` in a type annotation. The bot
 *     reported neither. Left on, it would emit a false finding for every new
 *     type-only identifier — a false-alarm generator, which corrodes a gate the
 *     same way a blind spot does.
 *
 * Scope note: `**\/__tests__/**` and `*.test.*` stay ignored because the bot
 * demonstrably does not lint them — established across four v1.1.x submissions
 * (see learned/skill-rules/agent-console.md § Community Plugins lint gate).
 * Keeping them out is parity, not leniency. `src/__test_stubs__/` IS in scope.
 */
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		// Mirror the bot's scan surface. Build output, vendored code, docs, and
		// transient worktrees are not source the bot reviews. `.mjs`/`.js`/`.cjs`
		// are excluded per calibration (A); tests per the scope note.
		ignores: [
			"node_modules/",
			"main.js",
			"docs/",
			".trees/",
			"tools/screenshots/fixtures/",
			"tools/smoke-test/studios/",
			"**/*.mjs",
			"**/*.js",
			"**/*.cjs",
			"vitest.config.ts",
			"**/__tests__/**",
			"**/*.test.ts",
			"**/*.test.tsx",
			"**/*.bench.ts",
		],
	},
	...obsidianmd.configs.recommended,
	{
		// Type-aware rules in the recommended set need a project. The root
		// tsconfig already includes both src/**/*.ts(x) and tools/**/*.ts, so
		// this reaches token-efficiency.ts with no extra project.
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		// Calibration (B) — see the header.
		rules: { "no-undef": "off" },
	},
]);
