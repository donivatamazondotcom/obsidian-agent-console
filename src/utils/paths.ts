import { execFile } from "child_process";
import { Platform } from "obsidian";
import { access, stat } from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildWslShellWrapper, getLoginShell } from "./platform";

/**
 * Sentinel markers wrapping the resolved path emitted by the interactive
 * login-shell probe in resolveCommandPath. They isolate the result from
 * interactive-shell rc chatter (instant-prompt banners, history-save lines).
 */
export const PATH_PROBE_START = "__ACP_PATH_START__";
export const PATH_PROBE_END = "__ACP_PATH_END__";

/**
 * Check whether a path string is an absolute path (Unix or Windows).
 */
export function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Best-effort fallback for when `which` returns nothing — e.g. macOS GUI-launched
 * apps (Finder/Dock) inherit a reduced PATH that excludes /opt/homebrew/bin, so
 * `which` can fail even when the command is installed. Probes common install
 * directories directly (PATH-independent), returning only an executable regular
 * file so the result matches what `which` would have returned.
 *
 * Probes the standard system dirs plus the common user-local agent homes
 * ~/.local/bin (the Kiro CLI.app symlink) and ~/.toolbox/bin (Amazon toolbox).
 * Still intentionally narrow: per-version version-manager shims
 * (nvm/fnm/asdf/volta/mise) cannot be enumerated by a static list and are out
 * of scope here — those are covered by the interactive login-shell probe in
 * resolveCommandPath, which sources .zshrc/.bashrc. (Windows solves the same
 * reduced-PATH problem authoritatively via the registry; see getFullWindowsPath
 * in platform.ts.)
 *
 * @param command - Bare command name (e.g. "node", "codex-acp")
 * @returns Absolute path to an executable file, or null if not found
 */
async function findInKnownPaths(command: string): Promise<string | null> {
	// Only resolve bare names within the listed dirs; never let a separator
	// escape via join() (defensive — current callers pass hardcoded names).
	if (command.includes("/") || command.includes("\\")) return null;

	const home = homedir();
	const userDirs = [join(home, ".local", "bin"), join(home, ".toolbox", "bin")];
	const dirs = Platform.isMacOS
		? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", ...userDirs]
		: ["/usr/local/bin", "/usr/bin", "/bin", ...userDirs];

	for (const dir of dirs) {
		const candidate = join(dir, command);
		try {
			const st = await stat(candidate); // follows symlinks
			if (!st.isFile()) continue; // reject directories/sockets
			await access(candidate, constants.X_OK); // must be executable
			return candidate;
		} catch {
			// missing / not a runnable file / dangling symlink → keep scanning
		}
	}

	return null;
}

/**
 * Resolve the absolute path of a command using `which` (macOS/Linux) or `where` (Windows).
 * If the command is already an absolute path, returns it as-is.
 * Runs asynchronously to avoid blocking the Electron main thread.
 *
 * @param command - Command name (e.g. "node", "claude") or absolute path
 * @returns Absolute path string, or null if not found
 */
export function resolveCommandPath(command: string): Promise<string | null> {
	if (!command || command.trim().length === 0) return Promise.resolve(null);

	const trimmed = command.trim();

	if (isAbsolutePath(trimmed)) {
		return Promise.resolve(trimmed);
	}

	return new Promise((resolve) => {
		if (Platform.isWin) {
			execFile(
				"where",
				[trimmed],
				{ timeout: 5000, windowsHide: true },
				(err, stdout) => {
					if (err) {
						resolve(null);
						return;
					}
					const resolved = stdout.split("\n")[0].trim();
					resolve(resolved.length > 0 ? resolved : null);
				},
			);
		} else {
			const shell = getLoginShell();
			const escaped = trimmed.replace(/'/g, "'\\''");
			const probe =
				`printf '${PATH_PROBE_START}%s${PATH_PROBE_END}' ` +
				`"$(command -v '${escaped}' 2>/dev/null)"`;
			const child = execFile(
				shell,
				["-i", "-l", "-c", probe],
				{ timeout: 8000 },
				(err, stdout) => {
					const fallback = () => {
						findInKnownPaths(trimmed).then(resolve, () =>
							resolve(null),
						);
					};
					if (err) {
						fallback();
						return;
					}
					const start = stdout.indexOf(PATH_PROBE_START);
					const end = stdout.indexOf(PATH_PROBE_END);
					const resolved =
						start !== -1 && end !== -1 && end > start
							? stdout
									.slice(start + PATH_PROBE_START.length, end)
									.trim()
							: "";
					if (resolved.length > 0) {
						resolve(resolved);
					} else {
						fallback();
					}
				},
			);
			// Close stdin so an interactive startup file (compinit / p10k
			// prompt) reads EOF instead of blocking on the inherited pipe.
			child?.stdin?.end();
		}
	});
}

/**
 * Extract the PATH value emitted between the sentinels by the interactive
 * login-shell probe in {@link resolveShellPath}. Returns null when the markers
 * are absent or the value is empty, so callers keep the inherited env PATH.
 */
export function parseShellPathOutput(stdout: string): string | null {
	const start = stdout.indexOf(PATH_PROBE_START);
	const end = stdout.indexOf(PATH_PROBE_END);
	if (start === -1 || end === -1 || end <= start) return null;
	const value = stdout.slice(start + PATH_PROBE_START.length, end).trim();
	return value.length > 0 ? value : null;
}

/**
 * Prepend the entries of `addition` (the captured shell PATH) ahead of
 * `existing` (the inherited env PATH), de-duplicating so the shell's
 * resolution order wins and dropping empty segments. Used to enrich the agent
 * spawn env on GUI-launched (reduced-PATH) macOS/Linux.
 */
export function prependPath(
	existing: string | undefined,
	addition: string,
): string {
	const sep = ":";
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of [
		...addition.split(sep),
		...(existing ?? "").split(sep),
	]) {
		if (part.length === 0 || seen.has(part)) continue;
		seen.add(part);
		out.push(part);
	}
	return out.join(sep);
}

/**
 * Capture the user's full PATH from an interactive login shell (which sources
 * .zshrc/.bashrc), so GUI-launched Obsidian — which inherits a reduced PATH
 * that omits interactive-rc PATH entries (Amazon toolbox ~/.toolbox/bin,
 * version-manager shims) — can still find agent CLIs at spawn time. Mirrors the
 * {@link resolveCommandPath} probe (interactive `-i -l -c` + sentinels + stdin
 * EOF so an interactive startup file reads EOF instead of blocking).
 *
 * Pattern per fix-path / shell-env / VS Code's resolveShellEnv: capture the
 * login-shell PATH once, then reuse it for child spawns. macOS/Linux only;
 * returns null on Windows (the registry path is used there) or on any failure
 * (the caller then keeps the inherited PATH).
 */
export function resolveShellPath(): Promise<string | null> {
	if (Platform.isWin) return Promise.resolve(null);

	return new Promise((resolve) => {
		const shell = getLoginShell();
		const probe = `printf '${PATH_PROBE_START}%s${PATH_PROBE_END}' "$PATH"`;
		const child = execFile(
			shell,
			["-i", "-l", "-c", probe],
			{ timeout: 8000 },
			(err, stdout) => {
				if (err) {
					resolve(null);
					return;
				}
				resolve(parseShellPathOutput(stdout));
			},
		);
		child?.stdin?.end();
	});
}

/**
 * Cached {@link resolveShellPath}. The capture costs one interactive-shell
 * spawn (sources rc files, can be slow), so it is memoized for the session;
 * repeated agent connects reuse the result.
 */
let cachedShellPath: Promise<string | null> | null = null;
export function getShellPath(): Promise<string | null> {
	if (!cachedShellPath) {
		cachedShellPath = resolveShellPath();
	}
	return cachedShellPath;
}

/**
 * Resolve the absolute path of a command inside WSL.
 * Uses the WSL shell wrapper (buildWslShellWrapper) to resolve within the Linux environment.
 *
 * @param command - Command name (e.g. "node", "claude")
 * @param distribution - Optional WSL distribution name
 * @returns Linux absolute path string, or null if not found
 */
export function resolveCommandPathInWsl(
	command: string,
	distribution?: string,
): Promise<string | null> {
	if (!command || command.trim().length === 0) return Promise.resolve(null);

	const trimmed = command.trim();

	if (isAbsolutePath(trimmed)) {
		return Promise.resolve(trimmed);
	}

	return new Promise((resolve) => {
		const escaped = trimmed.replace(/'/g, "'\\''");
		const args: string[] = [];
		if (distribution) {
			args.push("-d", distribution);
		}
		const innerCommand = `which '${escaped}'`;
		args.push("sh", "-c", buildWslShellWrapper(innerCommand));
		execFile(
			"C:\\Windows\\System32\\wsl.exe",
			args,
			{ timeout: 5000 },
			(err, stdout) => {
				if (err) {
					// No known-paths fallback here on purpose: a host-side
					// existsSync would check the Windows filesystem, not the
					// Linux FS inside WSL. The wrapper already runs a login
					// shell (-l, sources ~/.profile), so the reduced-PATH
					// problem is milder here than on a GUI-launched macOS app.
					resolve(null);
					return;
				}
				const resolved = stdout.split("\n")[0].trim();
				resolve(resolved.length > 0 ? resolved : null);
			},
		);
	});
}

/**
 * Extract the directory containing a command (for PATH adjustments).
 * Example: /usr/local/bin/node → /usr/local/bin
 *
 * @param command - Full path to a command
 * @returns Directory path, or null if cannot be determined
 */
export function resolveCommandDirectory(command: string): string | null {
	if (!command) {
		return null;
	}
	const lastSlash = Math.max(
		command.lastIndexOf("/"),
		command.lastIndexOf("\\"),
	);
	if (lastSlash <= 0) {
		return null;
	}
	return command.slice(0, lastSlash);
}

/**
 * Resolve the Node.js directory from the plugin's nodePath setting.
 * Returns the directory only when nodePath is an absolute path.
 * When nodePath is empty or a bare command name, returns undefined
 * (the login shell handles PATH resolution).
 *
 * @param nodePathSetting - The raw nodePath setting value
 * @returns Directory path, or undefined
 */
export function resolveNodeDirectory(
	nodePathSetting: string | undefined,
): string | undefined {
	if (!nodePathSetting) return undefined;
	const trimmed = nodePathSetting.trim();
	if (!isAbsolutePath(trimmed)) return undefined;
	return resolveCommandDirectory(trimmed) || undefined;
}

/**
 * Convert absolute path to relative path if it's under basePath.
 * Otherwise return the absolute path as-is.
 *
 * @param absolutePath - The absolute path to convert
 * @param basePath - The base path (e.g., vault path)
 * @returns Relative path if under basePath, otherwise absolute path
 */
export function toRelativePath(absolutePath: string, basePath: string): string {
	// Normalize paths (remove trailing slashes)
	const normalizedBase = basePath.replace(/\/+$/, "");
	const normalizedPath = absolutePath.replace(/\/+$/, "");

	if (normalizedPath.startsWith(normalizedBase + "/")) {
		return normalizedPath.slice(normalizedBase.length + 1);
	}
	return absolutePath;
}

/**
 * Build a file URI from an absolute path.
 * Handles both Windows and Unix paths.
 *
 * @param absolutePath - Absolute file path
 * @returns file:// URI
 *
 * @example
 * buildFileUri("/Users/user/note.md") // "file:///Users/user/note.md"
 * buildFileUri("C:\\Users\\user\\note.md") // "file:///C:/Users/user/note.md"
 */
export function buildFileUri(absolutePath: string): string {
	// Normalize backslashes to forward slashes
	const normalizedPath = absolutePath.replace(/\\/g, "/");

	// Windows path (e.g., C:/Users/...)
	if (/^[A-Za-z]:/.test(normalizedPath)) {
		return `file:///${normalizedPath}`;
	}

	// Unix path (e.g., /Users/...)
	return `file://${normalizedPath}`;
}
