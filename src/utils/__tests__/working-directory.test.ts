import { describe, it, expect } from "vitest";
import {
	resolveDefaultWorkingDirectory,
	resolveAgentWorkingDirectory,
	deriveCwdBanner,
} from "../working-directory";

const VAULT = "/Users/me/vault";

describe("resolveDefaultWorkingDirectory", () => {
	it("returns vault root for an empty value (default, not a fallback)", () => {
		const r = resolveDefaultWorkingDirectory("", VAULT, () => true);
		expect(r).toEqual({ dir: VAULT, fellBack: false });
	});

	it("treats a blank/whitespace value as empty → vault root, no fallback", () => {
		const r = resolveDefaultWorkingDirectory("   ", VAULT, () => true);
		expect(r).toEqual({ dir: VAULT, fellBack: false });
	});

	it("uses an absolute path that exists as a directory", () => {
		const r = resolveDefaultWorkingDirectory(
			"/Users/me/repo",
			VAULT,
			(p) => p === "/Users/me/repo",
		);
		expect(r).toEqual({ dir: "/Users/me/repo", fellBack: false });
	});

	it("falls back to vault root for a non-absolute path", () => {
		const r = resolveDefaultWorkingDirectory("repo/sub", VAULT, () => true);
		expect(r).toEqual({ dir: VAULT, fellBack: true });
	});

	it("falls back to vault root for an absolute path that does not exist", () => {
		const r = resolveDefaultWorkingDirectory(
			"/Users/me/missing",
			VAULT,
			() => false,
		);
		expect(r).toEqual({ dir: VAULT, fellBack: true });
	});

	it("trims surrounding whitespace before validating", () => {
		const r = resolveDefaultWorkingDirectory(
			"  /Users/me/repo  ",
			VAULT,
			(p) => p === "/Users/me/repo",
		);
		expect(r).toEqual({ dir: "/Users/me/repo", fellBack: false });
	});
});

describe("resolveAgentWorkingDirectory", () => {
	const VAULT = "/Users/me/vault";
	const GLOBAL = "/Users/me/global";
	const AGENT = "/Users/me/repo";
	const existsAll = () => true;

	it("prefers a valid per-agent directory over global and vault", () => {
		const r = resolveAgentWorkingDirectory(AGENT, GLOBAL, VAULT, existsAll);
		expect(r).toEqual({ dir: AGENT, source: "agent", fellBack: false });
	});

	it("falls through to global default when per-agent is blank", () => {
		const r = resolveAgentWorkingDirectory("", GLOBAL, VAULT, existsAll);
		expect(r).toEqual({ dir: GLOBAL, source: "global", fellBack: false });
	});

	it("falls through to vault root when both per-agent and global are blank", () => {
		const r = resolveAgentWorkingDirectory("", "", VAULT, existsAll);
		expect(r).toEqual({ dir: VAULT, source: "vault", fellBack: false });
	});

	it("skips an invalid per-agent value to a valid global, flagging fellBack", () => {
		// per-agent is non-absolute → skip; global is absolute + exists → use
		const r = resolveAgentWorkingDirectory(
			"relative/path",
			GLOBAL,
			VAULT,
			(p) => p === GLOBAL,
		);
		expect(r).toEqual({ dir: GLOBAL, source: "global", fellBack: true });
	});

	it("skips invalid per-agent AND invalid global down to vault, flagging fellBack", () => {
		const r = resolveAgentWorkingDirectory(
			"/Users/me/missing-agent",
			"/Users/me/missing-global",
			VAULT,
			() => false,
		);
		expect(r).toEqual({ dir: VAULT, source: "vault", fellBack: true });
	});

	it("does not flag fellBack when only blank values defer (no invalid value)", () => {
		const r = resolveAgentWorkingDirectory("  ", "", VAULT, existsAll);
		expect(r).toEqual({ dir: VAULT, source: "vault", fellBack: false });
	});
});

describe("deriveCwdBanner", () => {
	const VAULT_ROOT = "/Users/me/vault";

	it("hidden when agentCwd equals vaultRoot (same string)", () => {
		expect(deriveCwdBanner(VAULT_ROOT, VAULT_ROOT)).toBe(false);
	});

	it("hidden when agentCwd is empty", () => {
		expect(deriveCwdBanner("", VAULT_ROOT)).toBe(false);
	});

	it("shown when agentCwd is a different directory", () => {
		expect(deriveCwdBanner("/Users/me/repo", VAULT_ROOT)).toBe(true);
	});

	it("hidden when agentCwd differs only by trailing slash", () => {
		expect(deriveCwdBanner(VAULT_ROOT + "/", VAULT_ROOT)).toBe(false);
	});

	it("shown when agentCwd is a subdirectory of vaultRoot", () => {
		expect(deriveCwdBanner(VAULT_ROOT + "/subdir", VAULT_ROOT)).toBe(true);
	});

	it("shown when agentCwd is a parent of vaultRoot", () => {
		expect(deriveCwdBanner("/Users/me", VAULT_ROOT)).toBe(true);
	});
});
