import { describe, it, expect } from "vitest";
import {
	BUILTIN_AGENT_INSTALLS,
	buildInstallCommand,
	docsSetupUrl,
	DOCS_AGENT_SETUP_BASE,
} from "../agent-packages";

describe("agent-packages", () => {
	it("buildInstallCommand produces the global @latest install", () => {
		expect(buildInstallCommand("@scope/pkg")).toBe(
			"npm install -g @scope/pkg@latest",
		);
	});

	it("docsSetupUrl joins the base and slug", () => {
		expect(docsSetupUrl("claude-code")).toBe(
			`${DOCS_AGENT_SETUP_BASE}/claude-code`,
		);
	});

	it("Kiro is link-only (no npm package); the npm agents have packages", () => {
		const byId = new Map(BUILTIN_AGENT_INSTALLS.map((a) => [a.id, a]));
		expect(byId.get("kiro-cli")?.npmPackage).toBeNull();
		expect(byId.get("claude-code-acp")?.npmPackage).toBeTruthy();
		expect(byId.get("codex-acp")?.npmPackage).toBeTruthy();
		expect(byId.get("gemini-cli")?.npmPackage).toBeTruthy();
	});

	it("ids are unique and every entry has a displayName + docsSlug", () => {
		const ids = BUILTIN_AGENT_INSTALLS.map((a) => a.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const a of BUILTIN_AGENT_INSTALLS) {
			expect(a.displayName.length).toBeGreaterThan(0);
			expect(a.docsSlug.length).toBeGreaterThan(0);
		}
	});
});
