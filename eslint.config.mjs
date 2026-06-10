import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

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
]);
