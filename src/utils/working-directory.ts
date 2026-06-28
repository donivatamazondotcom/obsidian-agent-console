import { isAbsolute } from "path";
import { existsSync, statSync } from "fs";
import { isSameDirectory } from "./platform";

export interface ResolvedWorkingDirectory {
	/** The directory a new chat should launch in. */
	dir: string;
	/**
	 * True when a non-empty configured value was invalid (non-absolute or not
	 * an existing directory) and we fell back to the vault root. Callers use
	 * this to surface a Notice. An empty configured value is NOT a fallback —
	 * vault root is its intended default.
	 */
	fellBack: boolean;
}

/** Default existence check; injectable for tests. */
function directoryExists(p: string): boolean {
	try {
		return existsSync(p) && statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Resolve the effective default working directory for a NEW chat.
 *
 * Resolution rules (spec: Agent Console Configurable Working Directory, decisions (b)/(d)):
 * - Empty/blank configured value → vault root (the intended default, not a fallback).
 * - Absolute path to an existing directory → use it.
 * - Non-absolute, missing, or non-directory → vault root, flagged `fellBack`.
 *
 * This never throws and never blocks; an invalid configured value degrades to
 * the vault root so a new chat always launches somewhere valid.
 *
 * @param configured  The user-configured default working directory (may be "").
 * @param vaultRoot   The vault base path, used as the default and the fallback.
 * @param dirExists   Existence predicate (injectable for tests).
 */
export function resolveDefaultWorkingDirectory(
	configured: string,
	vaultRoot: string,
	dirExists: (p: string) => boolean = directoryExists,
): ResolvedWorkingDirectory {
	const value = (configured ?? "").trim();
	if (!value) {
		return { dir: vaultRoot, fellBack: false };
	}
	if (!isAbsolute(value) || !dirExists(value)) {
		return { dir: vaultRoot, fellBack: true };
	}
	return { dir: value, fellBack: false };
}

export interface ResolvedAgentWorkingDirectory {
	/** The directory a new chat with this agent should launch in. */
	dir: string;
	/** Which configured level supplied the directory. */
	source: "agent" | "global" | "vault";
	/**
	 * True when a non-empty configured value (agent and/or global) was invalid
	 * and was skipped on the way to the resolved directory. Callers surface a
	 * Notice. An empty value at any level is NOT a fallback — it just defers to
	 * the next level.
	 */
	fellBack: boolean;
}

/**
 * Resolve the working directory for a NEW chat with a specific agent, applying
 * precedence: per-agent default → global default → vault root.
 *
 * At each level an empty value defers to the next; a non-empty but invalid
 * value (non-absolute or missing) is skipped AND flags `fellBack` so the caller
 * can warn. Never throws; always returns a valid directory.
 *
 * @param agentDir     The agent's configured default working directory (may be "").
 * @param globalDir    The global default working directory (may be "").
 * @param vaultRoot    The vault base path — the final fallback.
 * @param dirExists    Existence predicate (injectable for tests).
 */
export function resolveAgentWorkingDirectory(
	agentDir: string,
	globalDir: string,
	vaultRoot: string,
	dirExists: (p: string) => boolean = directoryExists,
): ResolvedAgentWorkingDirectory {
	const agent = (agentDir ?? "").trim();
	const global = (globalDir ?? "").trim();
	let fellBack = false;

	if (agent) {
		if (isAbsolute(agent) && dirExists(agent)) {
			return { dir: agent, source: "agent", fellBack: false };
		}
		fellBack = true;
	}
	if (global) {
		if (isAbsolute(global) && dirExists(global)) {
			return { dir: global, source: "global", fellBack };
		}
		fellBack = true;
	}
	return { dir: vaultRoot, source: "vault", fellBack };
}

/**
 * Determine whether the cwd banner should be shown for a chat panel.
 *
 * The banner is visible when the chat's working directory differs from the
 * vault root — i.e. the agent is working outside the vault base path.
 * It must compare against `vaultRoot` (the true base path), NOT the tab's
 * operative cwd (`vaultPath`), because for a restored tab `agentCwd ===
 * vaultPath` and the banner would never render.
 *
 * @param agentCwd  The chat's current working directory.
 * @param vaultRoot The vault base path (from FileSystemAdapter.getBasePath()).
 * @returns Whether the cwd banner should be rendered.
 */
export function deriveCwdBanner(agentCwd: string, vaultRoot: string): boolean {
	if (!agentCwd || agentCwd === vaultRoot) return false;
	return !isSameDirectory(agentCwd, vaultRoot);
}
