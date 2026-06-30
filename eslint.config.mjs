import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

// tools/ is Node.js tooling (screenshot CDP scripts, CLI runners, benchmarks),
// not Obsidian renderer code. The obsidianmd ruleset targets plugin/renderer
// concerns (popout-window timers, no-console in shipped UI, sentence-case,
// component lifecycle) that don't apply to Node scripts — and several actively
// misfire there (e.g. `window` is undefined in Node, console output is the
// whole point of a CLI). Turn every obsidianmd rule off for tools/; the
// typescript-eslint rules stay on so real type/correctness issues are caught.
const obsidianmdRulesOff = Object.fromEntries(
	Object.keys(obsidianmd.rules).map((rule) => [`obsidianmd/${rule}`, "off"]),
);

export default defineConfig([
	{
		ignores: ["node_modules/", "main.js", "docs/", "vitest.config.ts", ".trees/", "tools/benchmark/token-efficiency.ts", "**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "**/*.bench.ts"],
	},
	...obsidianmd.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		rules: {
			// Preserve existing rules
			// Menu positioning must go through showMenuAtEvent() (utils/menu-registry)
			// so keyboard activation anchors to the trigger element instead of the
			// viewport origin (I115). Forbid the raw Obsidian APIs everywhere except
			// the wrapper itself (exempted below).
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"CallExpression[callee.property.name='showAtMouseEvent']",
					message:
						"Route menus through showMenuAtEvent() (utils/menu-registry) instead of calling menu.showAtMouseEvent directly, so keyboard activation anchors to the trigger element (I115).",
				},
				{
					selector:
						"CallExpression[callee.property.name='showAtPosition']",
					message:
						"Route menus through showMenuAtEvent() (utils/menu-registry) instead of calling menu.showAtPosition directly (I115).",
				},
				{
					selector: "Literal[value=/[⌘⌥⇧⌃]/]",
					message:
						"Don't hardcode Mac modifier glyphs (⌘ ⌥ ⇧ ⌃) — route through MOD_KEY/ALT_KEY/SHIFT_KEY/modCombo in utils/platform.ts so Windows/Linux show Ctrl/Alt/Shift (I134).",
				},
				{
					selector: "TemplateElement[value.raw=/[⌘⌥⇧⌃]/]",
					message:
						"Don't hardcode Mac modifier glyphs (⌘ ⌥ ⇧ ⌃) in template strings — route through utils/platform.ts (I134).",
				},
				{
					// Platform branching is owned by utils/platform.ts (MOD_KEY /
					// prepareShellCommand / WSL + Windows-PATH helpers). Reading
					// process.platform elsewhere re-introduces the variance the
					// platform util normalizes once at the edge. platform.ts is
					// exempt below. (Design-pattern guard; sibling of I134.)
					selector:
						"MemberExpression[object.name='process'][property.name='platform']",
					message:
						"Don't read process.platform directly — branch via utils/platform.ts so the platform check lives in one place (I134 sibling).",
				},
			],
			// The ACP SDK (@agentclientprotocol/sdk) is the system's external
			// contract and must stay behind the anti-corruption boundary in
			// src/acp/ (AcpClient port + AcpHandler/type-converter adapters). Any
			// other module must speak domain types, never the raw SDK shape, so a
			// change to the SDK can't ripple across the app. src/acp/** is exempt
			// below. (Anti-corruption boundary tenet — see "Lint Enforcement for
			// Design Patterns".)
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "@agentclientprotocol/sdk",
							message:
								"ACP SDK types must not escape src/acp/. Speak domain types; route through AcpClient / AcpHandler / type-converter (anti-corruption boundary).",
						},
					],
				},
			],
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-empty-function": "off",
			// Tagged-union exhaustiveness: a switch over a union that omits a
			// case (and has no default) fails the build, so a decision point
			// can't silently miss a new union member. considerDefaultExhaustive:
			// true lets event routers opt out with a `default`; decision points
			// (resolvers/reducers) stay strict by omitting one. See "Lint
			// Enforcement for Design Patterns" (Phase 3).
			"@typescript-eslint/switch-exhaustiveness-check": [
				"error",
				{ considerDefaultExhaustiveForUnions: true },
			],
			// 58 pre-existing violations across SettingsTab, ChatPanel, ChatView,
			// InputArea — many are legitimate proper nouns (e.g. "Windows Subsystem
			// for Linux", "Gemini API key") or technical UI strings. Demote to
			// warn until a dedicated cleanup pass.
			"obsidianmd/ui/sentence-case": "warn",
		},
	},
	{
		// Keyboard accessibility — enforce on React components (.tsx only).
		files: ["**/*.tsx"],
		plugins: { "jsx-a11y": jsxA11y },
		rules: {
			"jsx-a11y/click-events-have-key-events": "error",
			"jsx-a11y/no-static-element-interactions": "error",
			"jsx-a11y/no-noninteractive-element-interactions": "error",
			"jsx-a11y/interactive-supports-focus": "error",
		},
	},
	{
		// Node tooling — disable the obsidian renderer ruleset (see note above).
		files: ["tools/**/*.ts"],
		rules: obsidianmdRulesOff,
	},
	{
		// showMenuAtEvent is the sanctioned menu-positioning wrapper; it must call
		// the raw Menu APIs that every other module is forbidden from touching.
		files: ["src/utils/menu-registry.ts"],
		rules: { "no-restricted-syntax": "off" },
	},
	{
		// platform.ts is the single source of truth for the modifier-label glyphs
		// (I134) — it legitimately contains ⌘/⌥/⇧. It is a shell/platform util that
		// never calls Menu APIs, so dropping no-restricted-syntax wholesale here is
		// safe (the I115 menu rule has nothing to catch in this file).
		files: ["src/utils/platform.ts"],
		rules: { "no-restricted-syntax": "off" },
	},
	{
		// src/acp/ is the anti-corruption boundary — the only place allowed to
		// import the raw ACP SDK (AcpClient port + AcpHandler/type-converter
		// adapters). Exempt it from the SDK import ban.
		files: ["src/acp/**"],
		rules: { "no-restricted-imports": "off" },
	},
	{
		// src/resolvers/ is the functional core — pure decision functions
		// (derive*/decide*) that take plain inputs and return tagged unions.
		// They must not import the imperative shell (React, Obsidian) or the raw
		// ACP SDK, so the core stays framework-free and exhaustively unit-testable
		// (functional-core / imperative-shell). Totality is covered by the
		// exhaustiveness rule + tests, not a throw ban. See "Lint Enforcement for
		// Design Patterns".
		files: ["src/resolvers/**"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "react",
							message:
								"Resolvers are pure — no React. Keep the functional core framework-free; let the imperative shell (ui/, hooks/) render.",
						},
						{
							name: "react-dom",
							message:
								"Resolvers are pure — no React. Keep the functional core framework-free.",
						},
						{
							name: "obsidian",
							message:
								"Resolvers are pure — no Obsidian. Take plain inputs (and types from src/types); let the imperative shell touch the platform.",
						},
						{
							name: "@agentclientprotocol/sdk",
							message:
								"ACP SDK types must not escape src/acp/. Resolvers speak domain types.",
						},
					],
				},
			],
		},
	},
]);
