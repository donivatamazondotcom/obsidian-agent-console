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
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-empty-function": "off",
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
]);
