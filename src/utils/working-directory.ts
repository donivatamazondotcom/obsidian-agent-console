import { isAbsolute } from "path";
import { existsSync, statSync } from "fs";

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
