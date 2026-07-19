/**
 * In-plugin agent installer (first-run activation, mechanism (i)).
 *
 * Runs the one-line global npm install for an npm-backed built-in agent, using
 * the same login-shell PATH the agent spawn uses (so `npm` resolves the same
 * way the CLIs do — the I-FRO1 fix). Streams output to a callback and resolves
 * with a structured result.
 *
 * Feasibility note (2026-06-28 probe): a global install succeeds on Homebrew /
 * version-manager prefixes but fails with EACCES on system-node prefixes
 * (`/usr/local`, `/usr`) where the plugin cannot sudo. So a failure is NOT
 * exceptional — `summarizeInstallFailure` turns it into plain guidance and the
 * caller keeps the Copy-command fallback visible.
 *
 * The spawn is injectable (`spawnFn`) and the env can be supplied directly, so
 * the pure decision logic is unit-testable without spawning a real process.
 */
import { spawn } from "child_process";
import { Platform } from "obsidian";
import { getShellPath, prependPath } from "../utils/paths";
import { getEnhancedWindowsEnv } from "../utils/platform";
import { t } from "../i18n";

export interface InstallResult {
	/** True only on a clean exit (code 0). */
	ok: boolean;
	/** Process exit code, or null when the spawn itself failed. */
	exitCode: number | null;
	/** Plain-language guidance when !ok (no raw stack). */
	message?: string;
}

/** Minimal child-process shape we depend on — keeps spawnFn easy to fake. */
export interface InstallProcess {
	stdout: { on(ev: "data", cb: (chunk: Buffer | string) => void): void } | null;
	stderr: { on(ev: "data", cb: (chunk: Buffer | string) => void): void } | null;
	on(ev: "close", cb: (code: number | null) => void): void;
	on(ev: "error", cb: (err: Error) => void): void;
}

export type InstallSpawn = (
	command: string,
	args: string[],
	options: { env: NodeJS.ProcessEnv },
) => InstallProcess;

/** The command + args for a global npm install of `npmPackage@latest`. */
export function buildInstallArgs(npmPackage: string): {
	command: string;
	args: string[];
} {
	return { command: "npm", args: ["install", "-g", `${npmPackage}@latest`] };
}

/**
 * Turn a non-zero exit / spawn error into plain-language guidance. Always
 * steers the user to the Copy-command fallback, since the common failures
 * (missing npm, EACCES) are resolved in their own terminal.
 */
export function summarizeInstallFailure(
	exitCode: number | null,
	output: string,
): string {
	const text = output.toLowerCase();
	if (
		exitCode === 127 ||
		text.includes("command not found") ||
		text.includes("npm: not found") ||
		text.includes("enoent")
	) {
		return t("chat.installer.noNpm");
	}
	if (text.includes("eacces") || text.includes("permission denied")) {
		return t("chat.installer.needsPermission");
	}
	if (
		text.includes("etimedout") ||
		text.includes("enotfound") ||
		text.includes("network")
	) {
		return t("chat.installer.noNetwork");
	}
	return t("chat.installer.didntFinish");
}

/**
 * Build the spawn env with the login-shell PATH prepended (macOS/Linux) or the
 * registry-enhanced PATH (Windows), mirroring `AcpClient.doInitialize` so npm
 * resolves exactly like the agent CLIs do.
 */
export async function buildInstallEnv(): Promise<NodeJS.ProcessEnv> {
	let env: NodeJS.ProcessEnv = { ...process.env };
	if (Platform.isWin) {
		env = getEnhancedWindowsEnv(env);
	} else {
		const shellPath = await getShellPath();
		if (shellPath) {
			env.PATH = prependPath(env.PATH, shellPath);
		}
	}
	return env;
}

/**
 * Run `npm install -g <npmPackage>@latest`, streaming output to `onOutput`.
 * Never throws — a spawn failure or non-zero exit resolves to `{ ok: false }`
 * with plain-language `message`.
 */
export async function installAgent(
	npmPackage: string,
	opts: {
		onOutput?: (chunk: string) => void;
		/** Injectable spawn for tests; defaults to child_process.spawn. */
		spawnFn?: InstallSpawn;
		/** Pre-built env for tests; defaults to buildInstallEnv(). */
		env?: NodeJS.ProcessEnv;
	} = {},
): Promise<InstallResult> {
	const { command, args } = buildInstallArgs(npmPackage);
	const env = opts.env ?? (await buildInstallEnv());
	const doSpawn =
		opts.spawnFn ?? (spawn);

	return new Promise<InstallResult>((resolve) => {
		let output = "";
		let proc: InstallProcess;
		try {
			proc = doSpawn(command, args, { env });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			resolve({
				ok: false,
				exitCode: null,
				message: summarizeInstallFailure(null, msg),
			});
			return;
		}
		const onData = (chunk: Buffer | string) => {
			const s = typeof chunk === "string" ? chunk : chunk.toString();
			output += s;
			opts.onOutput?.(s);
		};
		proc.stdout?.on("data", onData);
		proc.stderr?.on("data", onData);
		proc.on("error", (err) => {
			resolve({
				ok: false,
				exitCode: null,
				message: summarizeInstallFailure(null, err.message),
			});
		});
		proc.on("close", (code) => {
			resolve(
				code === 0
					? { ok: true, exitCode: 0 }
					: {
							ok: false,
							exitCode: code,
							message: summarizeInstallFailure(code, output),
						},
			);
		});
	});
}
