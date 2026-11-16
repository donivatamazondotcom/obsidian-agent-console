import { spawn, ChildProcess, SpawnOptions } from "child_process";
import type AgentClientPlugin from "../plugin";
import { getLogger, Logger } from "../utils/logger";
import { Platform } from "obsidian";
import { resolveNodeDirectory } from "../utils/paths";
import { getEnhancedWindowsEnv, prepareShellCommand } from "../utils/platform";
import type { TerminalTiming } from "../types/chat-time";

/**
 * Parameters for creating a terminal process.
 *
 * This is the TerminalManager's own parameter type, independent of the ACP SDK.
 * The AcpClient is responsible for converting ACP protocol types to this format.
 */
interface CreateTerminalParams {
	/** The command to execute */
	command: string;
	/** Command arguments */
	args?: string[];
	/** Working directory for the command (absolute path) */
	cwd?: string;
	/** Environment variables as name-value pairs */
	env?: Array<{ name: string; value: string }>;
	/** Maximum number of output bytes to retain */
	outputByteLimit?: number;
}

interface TerminalProcess {
	id: string;
	process: ChildProcess;
	output: string;
	exitStatus: { exitCode: number | null; signal: string | null } | null;
	outputByteLimit?: number;
	waitPromises: Array<
		(exitStatus: { exitCode: number | null; signal: string | null }) => void
	>;
	cleanupTimeout?: number;
}

/** How long a released terminal's timing is kept: well past the 30 s cleanup. */
const TIMING_KEEP_AFTER_RELEASE_MS = 10 * 60_000;

export class TerminalManager {
	private terminals = new Map<string, TerminalProcess>();
	/**
	 * Chat Timestamps: per-terminal timing. Outlives the 30-second release
	 * cleanup; pruned 10 minutes after release (no timers) and cleared by
	 * killAllTerminals. Written only into an existing entry, so an exit after
	 * killAllTerminals can't recreate one.
	 */
	private timings = new Map<string, TerminalTiming>();
	private logger: Logger;
	private plugin: AgentClientPlugin;

	constructor(plugin: AgentClientPlugin) {
		this.logger = getLogger();
		this.plugin = plugin;
	}

	createTerminal(params: CreateTerminalParams): string {
		const terminalId = crypto.randomUUID();
		this.pruneTimings(Date.now());

		// Check current platform
		if (!Platform.isDesktopApp) {
			throw new Error("Agent Client is only available on desktop");
		}

		// Set up environment variables
		// Desktop-only: Node.js process environment for terminal operations
		let env: NodeJS.ProcessEnv = { ...process.env };

		// On Windows (non-WSL mode), enhance PATH with full system/user PATH from registry.
		// Electron apps launched from shortcuts don't inherit the full PATH.
		if (Platform.isWin && !this.plugin.settings.windowsWslMode) {
			env = getEnhancedWindowsEnv(env);
		}

		if (params.env) {
			for (const envVar of params.env) {
				env[envVar.name] = envVar.value;
			}
		}

		// Handle command parsing
		let command = params.command;
		let args = params.args || [];

		// Platform-specific shell wrapping
		const nodeDir = resolveNodeDirectory(this.plugin.settings.nodePath);
		const prepared = prepareShellCommand(
			command,
			args,
			params.cwd || process.cwd(),
			{
				wslMode: this.plugin.settings.windowsWslMode,
				wslDistribution: this.plugin.settings.windowsWslDistribution,
				nodeDir,
				alwaysEscape: false,
			},
		);
		command = prepared.command;
		args = prepared.args;
		const needsShell = prepared.needsShell;

		this.logger.log(`[Terminal ${terminalId}] Creating terminal:`, {
			command,
			args,
			cwd: params.cwd,
		});

		// Spawn the process
		const spawnOptions: SpawnOptions = {
			cwd: params.cwd || undefined,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			shell: needsShell,
		};
		const childProcess = spawn(command, args, spawnOptions);

		const terminal: TerminalProcess = {
			id: terminalId,
			process: childProcess,
			output: "",
			exitStatus: null,
			outputByteLimit:
				params.outputByteLimit !== undefined
					? Number(params.outputByteLimit)
					: undefined,
			waitPromises: [],
		};

		// Handle spawn errors
		childProcess.on("error", (error) => {
			this.logger.log(
				`[Terminal ${terminalId}] Process error:`,
				error.message,
			);
			// Set exit status to indicate failure
			const exitStatus = { exitCode: 127, signal: null }; // 127 = command not found
			terminal.exitStatus = exitStatus;
			this.markExited(terminalId);
			// Resolve all waiting promises
			terminal.waitPromises.forEach((resolve) => resolve(exitStatus));
			terminal.waitPromises = [];
		});

		// Capture stdout and stderr
		childProcess.stdout?.on("data", (data: Buffer) => {
			const output = data.toString();
			this.logger.log(`[Terminal ${terminalId}] stdout:`, output);
			this.appendOutput(terminal, output);
			this.markOutput(terminalId);
		});

		childProcess.stderr?.on("data", (data: Buffer) => {
			const output = data.toString();
			this.logger.log(`[Terminal ${terminalId}] stderr:`, output);
			this.appendOutput(terminal, output);
			this.markOutput(terminalId);
		});

		// Handle process exit
		childProcess.on("exit", (code, signal) => {
			this.logger.log(
				`[Terminal ${terminalId}] Process exited with code: ${code}, signal: ${signal}`,
			);
			const exitStatus = { exitCode: code, signal };
			terminal.exitStatus = exitStatus;
			this.markExited(terminalId);
			// Resolve all waiting promises
			terminal.waitPromises.forEach((resolve) => resolve(exitStatus));
			terminal.waitPromises = [];
		});

		this.terminals.set(terminalId, terminal);
		this.timings.set(terminalId, {
			lastOutputAt: null,
			exitedAt: null,
			releasedAt: null,
		});
		return terminalId;
	}

	/** A copy of a terminal's timing, or null for an id this manager never spawned. */
	getTiming(terminalId: string): TerminalTiming | null {
		const timing = this.timings.get(terminalId);
		return timing ? { ...timing } : null;
	}

	private markOutput(terminalId: string): void {
		const timing = this.timings.get(terminalId);
		if (timing) timing.lastOutputAt = Date.now();
	}

	private markExited(terminalId: string): void {
		const timing = this.timings.get(terminalId);
		if (timing && timing.exitedAt === null) timing.exitedAt = Date.now();
	}

	private pruneTimings(now: number): void {
		for (const [id, timing] of this.timings) {
			if (
				timing.releasedAt !== null &&
				now - timing.releasedAt > TIMING_KEEP_AFTER_RELEASE_MS
			) {
				this.timings.delete(id);
			}
		}
	}

	private appendOutput(terminal: TerminalProcess, data: string): void {
		terminal.output += data;

		// Apply output byte limit if specified
		if (
			terminal.outputByteLimit &&
			Buffer.byteLength(terminal.output, "utf8") >
				terminal.outputByteLimit
		) {
			// Truncate from the beginning, ensuring we stay at character boundaries
			const bytes = Buffer.from(terminal.output, "utf8");
			const truncatedBytes = bytes.subarray(
				bytes.length - terminal.outputByteLimit,
			);
			terminal.output = truncatedBytes.toString("utf8");
		}
	}

	getOutput(terminalId: string): {
		output: string;
		truncated: boolean;
		exitStatus: { exitCode: number | null; signal: string | null } | null;
	} | null {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return null;

		return {
			output: terminal.output,
			truncated: terminal.outputByteLimit
				? Buffer.byteLength(terminal.output, "utf8") >=
					terminal.outputByteLimit
				: false,
			exitStatus: terminal.exitStatus,
		};
	}

	waitForExit(
		terminalId: string,
	): Promise<{ exitCode: number | null; signal: string | null }> {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) {
			return Promise.reject(
				new Error(`Terminal ${terminalId} not found`),
			);
		}

		if (terminal.exitStatus) {
			return Promise.resolve(terminal.exitStatus);
		}

		return new Promise((resolve) => {
			terminal.waitPromises.push(resolve);
		});
	}

	killTerminal(terminalId: string): boolean {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return false;

		if (!terminal.exitStatus) {
			terminal.process.kill("SIGTERM");
		}
		return true;
	}

	releaseTerminal(terminalId: string): boolean {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return false;

		this.logger.log(`[Terminal ${terminalId}] Releasing terminal`);
		const now = Date.now();
		const timing = this.timings.get(terminalId);
		if (timing && timing.releasedAt === null) timing.releasedAt = now;
		this.pruneTimings(now);
		if (!terminal.exitStatus) {
			terminal.process.kill("SIGTERM");
		}

		// Schedule cleanup after 30 seconds to allow UI to poll final output
		terminal.cleanupTimeout = window.setTimeout(() => {
			this.logger.log(
				`[Terminal ${terminalId}] Cleaning up terminal after grace period`,
			);
			this.terminals.delete(terminalId);
		}, 30000);

		return true;
	}

	/**
	 * A terminal the agent started is still running (I209: a live terminal
	 * keeps the tab's process from being released).
	 */
	hasLiveTerminals(): boolean {
		for (const terminal of this.terminals.values()) {
			if (terminal.exitStatus === null) return true;
		}
		return false;
	}

	killAllTerminals(): void {
		this.logger.log(`Killing ${this.terminals.size} running terminals...`);
		this.terminals.forEach((terminal, terminalId) => {
			// Clear cleanup timeout if scheduled
			if (terminal.cleanupTimeout) {
				window.clearTimeout(terminal.cleanupTimeout);
			}
			if (!terminal.exitStatus) {
				this.logger.log(`Killing terminal ${terminalId}`);
				this.killTerminal(terminalId);
			}
		});
		// Clear all terminals
		this.terminals.clear();
		this.timings.clear();
	}
}
