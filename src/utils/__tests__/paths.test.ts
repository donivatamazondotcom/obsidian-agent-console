/**
 * I01 (Agent Console Agent Config UX): Auto-detect returns "Not Found" for an
 * installed CLI whose PATH entry lives in `.zshrc` / `.bashrc`.
 *
 * Confirmed root cause (tengli@ repro, 2026-06-19):
 *   - kiro-cli is at ~/.local/bin/kiro-cli; the ~/.local/bin PATH entry is
 *     defined only in .zshrc.
 *   - resolveCommandPath spawns a LOGIN, NON-INTERACTIVE shell (`zsh -l -c`),
 *     which sources .zshenv/.zprofile/.zlogin but NOT .zshrc — so under the
 *     reduced GUI-Obsidian PATH the probe never sees ~/.local/bin.
 *   - The findInKnownPaths fallback only probes /opt/homebrew/bin,
 *     /usr/local/bin, /usr/bin, /bin — not ~/.local/bin or ~/.toolbox/bin —
 *     so it cannot recover. → "Not Found".
 *
 * Two fixes (approved scope (c)):
 *   (b) probe with an INTERACTIVE login shell (`-i -l -c`) so .zshrc/.bashrc
 *       PATH additions are sourced; isolate the result from rc chatter with a
 *       sentinel delimiter.
 *   (a) extend findInKnownPaths to include ~/.local/bin and ~/.toolbox/bin.
 *
 * Test gate per SDLC § Stack-Trace Patch Anti-Pattern: these MUST be red
 * against the unfixed code and green after the fix.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const { execFileMock, statMock, accessMock } = vi.hoisted(() => ({
	execFileMock: vi.fn(),
	statMock: vi.fn(),
	accessMock: vi.fn(),
}));

vi.mock("obsidian", () => {
	const m = { Platform: { isMacOS: true, isWin: false } };
	return { ...m, default: m };
});

vi.mock("child_process", () => {
	const execFile = (...args: unknown[]) => execFileMock(...args);
	return { execFile, default: { execFile } };
});

vi.mock("fs/promises", () => {
	const stat = (...args: unknown[]) => statMock(...args);
	const access = (...args: unknown[]) => accessMock(...args);
	return { stat, access, default: { stat, access } };
});

vi.mock("os", () => {
	const homedir = () => "/Users/tengli";
	return { homedir, default: { homedir } };
});

vi.mock("../platform", () => {
	const getLoginShell = () => "/bin/zsh";
	const buildWslShellWrapper = (c: string) => c;
	return {
		getLoginShell,
		buildWslShellWrapper,
		default: { getLoginShell, buildWslShellWrapper },
	};
});

import {
	resolveCommandPath,
	PATH_PROBE_START,
	PATH_PROBE_END,
} from "../paths";

/** Make execFile invoke its callback with (err, stdout, stderr). */
function execFileYields(err: Error | null, stdout: string, stderr = "") {
	execFileMock.mockImplementation(
		(_file: string, _args: string[], _opts: unknown, cb: unknown) => {
			(cb as (e: Error | null, o: string, s: string) => void)(
				err,
				stdout,
				stderr,
			);
		},
	);
}

describe("I01: resolveCommandPath sources interactive-login PATH", () => {
	beforeEach(() => {
		execFileMock.mockReset();
		statMock.mockReset();
		accessMock.mockReset();
	});

	// Fix (b): the probe must run an INTERACTIVE login shell so .zshrc/.bashrc
	// PATH additions are sourced.
	it("invokes the login shell with the interactive flag (-i -l -c)", async () => {
		execFileYields(
			null,
			`${PATH_PROBE_START}/Users/tengli/.local/bin/kiro-cli${PATH_PROBE_END}`,
		);

		await resolveCommandPath("kiro-cli");

		expect(execFileMock).toHaveBeenCalledTimes(1);
		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-i");
		expect(args).toContain("-l");
		expect(args).toContain("-c");
	});

	// Fix (b): result must be isolated from interactive-shell rc chatter
	// (e.g. the "Saving session..." history dump) via sentinel markers.
	it("extracts the path from noisy interactive-shell stdout", async () => {
		const noisy = [
			"powerlevel10k instant prompt warning",
			"some .zshrc echo",
			`${PATH_PROBE_START}/Users/tengli/.local/bin/kiro-cli${PATH_PROBE_END}`,
			"Saving session...",
			"...saving history...",
		].join("\n");
		execFileYields(null, noisy);

		await expect(resolveCommandPath("kiro-cli")).resolves.toBe(
			"/Users/tengli/.local/bin/kiro-cli",
		);
	});
});

describe("I01: findInKnownPaths fallback covers user-local agent dirs", () => {
	beforeEach(() => {
		execFileMock.mockReset();
		statMock.mockReset();
		accessMock.mockReset();
		// Simulate the GUI-PATH failure: the shell probe finds nothing,
		// forcing the findInKnownPaths fallback.
		execFileYields(null, `${PATH_PROBE_START}${PATH_PROBE_END}`);
	});

	function fsResolvesOnly(target: string) {
		statMock.mockImplementation((p: string) =>
			p === target
				? Promise.resolve({ isFile: () => true })
				: Promise.reject(new Error("ENOENT")),
		);
		accessMock.mockImplementation((p: string) =>
			p === target
				? Promise.resolve(undefined)
				: Promise.reject(new Error("EACCES")),
		);
	}

	// Fix (a): the Kiro CLI.app symlink case (tengli's machine).
	it("resolves a command installed in ~/.local/bin", async () => {
		fsResolvesOnly("/Users/tengli/.local/bin/kiro-cli");
		await expect(resolveCommandPath("kiro-cli")).resolves.toBe(
			"/Users/tengli/.local/bin/kiro-cli",
		);
	});

	// Fix (a): the Amazon-toolbox install case.
	it("resolves a command installed in ~/.toolbox/bin", async () => {
		fsResolvesOnly("/Users/tengli/.toolbox/bin/kiro-cli");
		await expect(resolveCommandPath("kiro-cli")).resolves.toBe(
			"/Users/tengli/.toolbox/bin/kiro-cli",
		);
	});
});
