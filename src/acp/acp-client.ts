import { spawn, ChildProcess } from "child_process";
import * as acp from "@agentclientprotocol/sdk";
import {
	A2UI_CAPABILITY_META_KEY,
	buildA2uiCapabilityMeta,
} from "../services/a2ui/capability";
import {
	buildClientCapabilities,
	clientShellType,
	KIRO_TERMINAL_SHELL_TYPE_METHOD,
	kiroV3SessionMeta,
	prepareKiroV3Launch,
	resolveLaunchArgs,
} from "./kiro-v3";
import {
	adaptPromptForEngine,
	allowsLegacySetModel,
	acceptsInitialConfigPicks,
	storesSessionConfig,
	type InitialConfigPicks,
} from "./kiro-v3";
import { Platform } from "obsidian";

import type {
	InitializeResult,
	SessionConfigOption,
	SessionUpdate,
	ListSessionsResult,
	SessionResult,
} from "../types/session";
import type { PermissionScopeChoice, PromptContent } from "../types/chat";
import type { ProcessError } from "../types/errors";
import { AcpTypeConverter } from "./type-converter";
import { TerminalManager } from "./terminal-handler";
import { PermissionManager } from "./permission-handler";
import { AcpHandler } from "./acp-handler";
import {
	nodeProcessOps,
	teardownProcessTree,
	type ProcessOps,
} from "./process-teardown";
import {
	KIRO_MCP_RESET_SERVER_METHOD,
	KIRO_MCP_STATUS_METHOD,
	KIRO_OPEN_EXTERNAL_URL_METHOD,
	MCP_OAUTH_REQUEST_METHOD,
	MCP_SERVER_INITIALIZED_METHOD,
	parseKiroMcpStatus,
	parseOpenExternalUrl,
	parseMcpOauthRequest,
	parseMcpServerInitialized,
} from "./mcp-auth-parsers";
import type { McpAuthEvent } from "../types/mcp-auth";
import { getLogger, Logger } from "../utils/logger";
import type AgentClientPlugin from "../plugin";
import {
	convertWindowsPathToWsl,
	getEnhancedWindowsEnv,
	getLoginShell,
	prepareShellCommand,
} from "../utils/platform";
import {
	resolveNodeDirectory,
	getShellPath,
	prependPath,
} from "../utils/paths";
import {
	extractStderrErrorHint,
	getSpawnErrorInfo,
	getCommandNotFoundSuggestion,
	isEmptyResponseError,
	isUserAbortedError,
} from "../utils/error-utils";

/**
 * Runtime configuration for launching an AI agent process.
 * Converted from BaseAgentSettings by toAgentConfig() in settings-service.
 */
export interface AgentConfig {
	id: string;
	displayName: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	workingDirectory: string;
	/**
	 * Optional API key injection intent.
	 * When present, AcpClient.initialize() resolves the secret value from
	 * Obsidian's secret storage and injects it into the spawn environment
	 * as `envVarName`. Custom agents typically don't set this (they use
	 * env vars directly).
	 */
	apiKey?: {
		/** Secret storage ID to look up at spawn time */
		secretId: string;
		/** Environment variable name to inject the resolved value into */
		envVarName: string;
	};
	/**
	 * Kiro CLI only: launch the v3 ACP server. Set by
	 * buildAgentConfigWithApiKey() from the Kiro engine setting; absent means
	 * the v2 server and today's launch/session behavior. See kiro-v3.ts.
	 */
	kiroEngine?: "v3";
}

/**
 * Result of polling terminal output.
 */
export interface TerminalOutputResult {
	output: string;
	truncated: boolean;
	exitStatus: {
		exitCode: number | null;
		signal: string | null;
	} | null;
}

/**
 * ACP client for agent communication and process lifecycle management.
 */
export class AcpClient {
	// Connection & process
	private connection: acp.ClientConnection | null = null;
	private agentProcess: ChildProcess | null = null;
	private currentConfig: AgentConfig | null = null;
	private isInitializedFlag = false;
	private currentAgentId: string | null = null;
	private currentSessionId: string | null = null;

	/**
	 * In-flight initialize() promise, used to coalesce concurrent
	 * same-agent calls (I46). Cleared when the call settles.
	 */
	private initializePromise: Promise<InitializeResult> | null = null;
	private initializingAgentId: string | null = null;
	/** Cached InitializeResult so capabilities survive past a discarded
	 * eager-init return value — read by the restored-tab load path (I47). */
	private cachedInitResult: InitializeResult | null = null;

	// Callbacks (none — all events flow through onSessionUpdate via AcpHandler)

	// Delegates
	private terminalManager: TerminalManager;
	private permissionManager: PermissionManager;
	private handler: AcpHandler;

	// Prompt state (reset per sendPrompt)
	private recentStderr = "";

	private logger: Logger;

	constructor(private plugin: AgentClientPlugin) {
		this.logger = getLogger();

		// Initialize managers
		this.terminalManager = new TerminalManager(plugin);
		this.permissionManager = new PermissionManager(
			{
				onSessionUpdate: (update) =>
					this.handler.emitSessionUpdate(update),
			},
			false, // autoAllow — updated in initialize()
		);

		// Initialize protocol handler
		this.handler = new AcpHandler(
			this.permissionManager,
			this.terminalManager,
			() => this.currentConfig?.workingDirectory ?? "",
			() => this.currentSessionId,
			this.logger,
			() =>
				clientShellType({
					platform: Platform.isWin ? "win32" : "posix",
					loginShell: Platform.isWin ? "" : getLoginShell(),
					wslMode: this.plugin.settings.windowsWslMode,
				}),
		);
	}

	/**
	 * Initialize connection to an AI agent.
	 * Spawns the agent process and establishes ACP connection.
	 */
	async initialize(config: AgentConfig): Promise<InitializeResult> {
		// Coalesce concurrent initialize() calls for the SAME agent onto one
		// in-flight promise (I46). Without this, a second caller (e.g. the
		// lazy createSession firing on first keystroke during the eager-init
		// handshake) re-enters doInitialize, whose killProcessTree() kills the
		// in-flight process and restarts the handshake — the visible
		// ready→connecting→ready flicker. A different agent id is a genuine
		// agent switch and is NOT coalesced.
		if (this.initializePromise && this.initializingAgentId === config.id) {
			this.logger.log(
				`initialize() already in flight for ${config.id}; awaiting existing promise`,
			);
			return this.initializePromise;
		}

		const promise = this.doInitialize(config);
		this.initializePromise = promise;
		this.initializingAgentId = config.id;
		try {
			const result = await promise;
			this.cachedInitResult = result;
			return result;
		} finally {
			// Only clear if a newer initialize() hasn't superseded this one.
			if (this.initializePromise === promise) {
				this.initializePromise = null;
				this.initializingAgentId = null;
			}
		}
	}

	private async doInitialize(
		config: AgentConfig,
	): Promise<InitializeResult> {
		this.logger.log(
			"Starting initialization with config:",
			this.getSafeConfigForLog(config),
		);
		this.logger.log(
			`Current state - process: ${!!this.agentProcess}, PID: ${this.agentProcess?.pid}`,
		);

		// Clean up existing process if any (e.g., when switching agents)
		if (this.agentProcess) {
			this.killProcessTree();
		}

		// Clean up existing connection
		if (this.connection) {
			this.logger.log("Cleaning up existing connection");
			this.connection = null;
		}

		this.currentConfig = config;

		// Update auto-allow permissions from plugin settings
		this.permissionManager.setAutoAllow(
			this.plugin.settings.autoAllowPermissions,
		);

		// Validate command
		if (!config.command || config.command.trim().length === 0) {
			throw new Error(
				`Command not configured for agent "${config.displayName}" (${config.id}). Please configure the agent command in settings.`,
			);
		}

		const command = config.command.trim();
		const args = resolveLaunchArgs(config);
		if (config.kiroEngine === "v3") {
			const { stripped } = prepareKiroV3Launch(config.args);
			if (stripped.length > 0) {
				this.logger.log(
					`Kiro V3: moved ${stripped.join(", ")} out of the launch args (V3 takes them per session)`,
				);
			}
		}

		this.logger.log(
			`Active agent: ${config.displayName} (${config.id})`,
		);
		this.logger.log("Command:", command);
		this.logger.log(
			"Args:",
			args.length > 0 ? args.join(" ") : "(none)",
		);

		// Prepare environment variables
		let baseEnv: NodeJS.ProcessEnv = {
			...process.env,
			...(config.env || {}),
		};

		// On Windows, enhance PATH with full system/user PATH from registry.
		// Electron apps launched from shortcuts don't inherit the full PATH,
		// which causes executables like python, node, etc. to not be found.
		if (Platform.isWin && !this.plugin.settings.windowsWslMode) {
			baseEnv = getEnhancedWindowsEnv(baseEnv);
		}

		// On macOS/Linux, GUI-launched Obsidian inherits a reduced PATH that
		// omits interactive-rc PATH entries (~/.toolbox/bin, version-manager
		// shims), so a bare agent command can fail to spawn even when it
		// resolves in the user's terminal. Capture the login-shell PATH once
		// (cached) and prepend it. Mirrors fix-path / VS Code resolveShellEnv;
		// Windows uses getEnhancedWindowsEnv above. (I-FRO1)
		if (!Platform.isWin && !this.plugin.settings.windowsWslMode) {
			const shellPath = await getShellPath();
			if (shellPath) {
				baseEnv.PATH = prependPath(baseEnv.PATH, shellPath);
			}
		}

		// Add Node.js directory to PATH only when nodePath is an explicit absolute path.
		// When nodePath is empty or a bare command name, the login shell handles it.
		const nodeDir = resolveNodeDirectory(this.plugin.settings.nodePath);
		if (nodeDir) {
			const separator = Platform.isWin ? ";" : ":";
			baseEnv.PATH = baseEnv.PATH
				? `${nodeDir}${separator}${baseEnv.PATH}`
				: nodeDir;
			this.logger.log(
				"Node.js directory added to PATH:",
				nodeDir,
			);
		}

		// Resolve API key secret just before spawn so the latest value is used.
		// Custom agents don't set config.apiKey and inject keys via env directly.
		if (config.apiKey) {
			const secretValue =
				this.plugin.app.secretStorage.getSecret(
					config.apiKey.secretId,
				) ?? "";
			baseEnv[config.apiKey.envVarName] = secretValue;
		}

		this.logger.log(
			"Starting agent process in directory:",
			config.workingDirectory,
		);

		// Prepare command and args for spawning (platform-specific shell wrapping)
		const prepared = prepareShellCommand(
			command,
			args,
			config.workingDirectory,
			{
				wslMode: this.plugin.settings.windowsWslMode,
				wslDistribution: this.plugin.settings.windowsWslDistribution,
				nodeDir,
				alwaysEscape: true,
			},
		);
		const spawnCommand = prepared.command;
		const spawnArgs = prepared.args;
		const needsShell = prepared.needsShell;

		this.logger.log(
			"Prepared spawn command:",
			spawnCommand,
			spawnArgs,
		);

		// Spawn the agent process
		// detached: true (Unix only) creates a new process group, allowing us to kill
		// the entire process tree (agent + child processes) with process.kill(-pid).
		// On Windows, detached: true opens a new console window, so we skip it
		// and use taskkill /T instead for tree kill.
		const agentProcess = spawn(spawnCommand, spawnArgs, {
			stdio: ["pipe", "pipe", "pipe"],
			env: baseEnv,
			cwd: config.workingDirectory,
			shell: needsShell,
			detached: !Platform.isWin,
		});
		this.agentProcess = agentProcess;

		const agentLabel = `${config.displayName} (${config.id})`;

		// Set up process event handlers
		agentProcess.on("spawn", () => {
			this.logger.log(
				`${agentLabel} process spawned successfully, PID:`,
				agentProcess.pid,
			);
		});

		agentProcess.on("error", (error) => {
			this.logger.error(
				`${agentLabel} process error:`,
				error,
			);

			const processError: ProcessError = {
				type: "spawn_failed",
				agentId: config.id,
				errorCode: (error as NodeJS.ErrnoException).code,
				originalError: error,
				...getSpawnErrorInfo(
					error,
					command,
					agentLabel,
					this.plugin.settings.windowsWslMode,
				),
			};

			this.handler.emitSessionUpdate({
				type: "process_error",
				sessionId: this.currentSessionId ?? "",
				error: processError,
			});
		});

		agentProcess.on("exit", (code, signal) => {
			this.logger.log(
				`${agentLabel} process exited with code:`,
				code,
				"signal:",
				signal,
			);

			if (code === 127) {
				this.logger.error(`Command not found: ${command}`);

				const processError: ProcessError = {
					type: "command_not_found",
					agentId: config.id,
					exitCode: code,
					title: `Can't start ${agentLabel}`,
					message: `${agentLabel} doesn't look installed (couldn't run "${command}"). Install it, or open Settings to set its path.`,
					suggestion: getCommandNotFoundSuggestion(
						command,
						this.plugin.settings.windowsWslMode,
					),
				};

				this.handler.emitSessionUpdate({
					type: "process_error",
					sessionId: this.currentSessionId ?? "",
					error: processError,
				});
			}

			// #286: agent process died on its own; reconcile client state
			// so a reconnect starts clean.
			this.reconcileProcessGone(agentProcess);
		});

		agentProcess.on("close", (code, signal) => {
			this.logger.log(
				`${agentLabel} process closed with code:`,
				code,
				"signal:",
				signal,
			);
			this.reconcileProcessGone(agentProcess);
		});

		agentProcess.stderr?.setEncoding("utf8");
		agentProcess.stderr?.on("data", (data) => {
			this.logger.log(`${agentLabel} stderr:`, data);
			// Keep a rolling window of recent stderr for error diagnostics
			this.recentStderr += data;
			if (this.recentStderr.length > 8192) {
				this.recentStderr = this.recentStderr.slice(-4096);
			}
		});

		// Create stream for ACP communication
		// stdio is configured as ["pipe", "pipe", "pipe"] so stdin/stdout are guaranteed to exist
		if (!agentProcess.stdin || !agentProcess.stdout) {
			throw new Error("Agent process stdin/stdout not available");
		}

		const stdin = agentProcess.stdin;
		const stdout = agentProcess.stdout;

		const input = new WritableStream<Uint8Array>({
			write(chunk: Uint8Array) {
				stdin.write(chunk);
			},
			close() {
				stdin.end();
			},
		});
		const output = new ReadableStream<Uint8Array>({
			start(controller) {
				stdout.on("data", (chunk: Uint8Array) => {
					controller.enqueue(chunk);
				});
				stdout.on("end", () => {
					controller.close();
				});
			},
		});

		this.logger.log(
			"Using working directory:",
			config.workingDirectory,
		);

		const stream = acp.ndJsonStream(input, output);
		this.connection = registerClientHandlers(
			acp.client({ name: "agent-console" }),
			this.handler,
		).connect(stream);

		// #286: reap the child if the ACP connection closes for ANY reason
		// (agent EOF, protocol error, explicit close) — including while the
		// process itself is still alive and blocked on stdin.
		this.watchConnectionClosed(this.connection, agentProcess);

		try {
			this.logger.log("Starting ACP initialization...");

			const initResult = await this.connection.agent.request(acp.methods.agent.initialize, {
				protocolVersion: acp.PROTOCOL_VERSION,
				// D9 a2ui binding for every agent; the Kiro V3 hooks opt-in
				// only for a v3 config. See kiro-v3.ts.
				clientCapabilities: buildClientCapabilities(config, {
					[A2UI_CAPABILITY_META_KEY]: buildA2uiCapabilityMeta(),
				}),
				clientInfo: {
					name: "agent-console",
					title: "Agent Console for Obsidian",
					version: this.plugin.manifest.version,
				},
			});

			this.logger.log(
				`✅ Connected to agent (protocol v${initResult.protocolVersion})`,
			);
			this.logger.log("agentInfo:", initResult.agentInfo);

			this.isInitializedFlag = true;
			this.currentAgentId = config.id;

			return AcpTypeConverter.toInitializeResult(initResult, config);
		} catch (error) {
			this.logger.error("Initialization Error:", error);

			// Reset flags on failure
			this.isInitializedFlag = false;
			this.currentAgentId = null;

			throw error;
		}
	}

	private getSafeConfigForLog(config: AgentConfig): {
		id: string;
		displayName: string;
		command: string;
		args: string[];
		envKeys: string[];
		workingDirectory: string;
		apiKeyEnvVar?: string;
	} {
		return {
			id: config.id,
			displayName: config.displayName,
			command: config.command,
			args: [...config.args],
			envKeys: Object.keys(config.env || {}),
			workingDirectory: config.workingDirectory,
			// Log env var name only — never the secret ID or value
			apiKeyEnvVar: config.apiKey?.envVarName,
		};
	}

	/**
	 * Update the auto-allow permission setting on a live client.
	 * Called by the plugin when the setting changes at runtime.
	 */
	updateAutoAllow(autoAllow: boolean): void {
		this.permissionManager.setAutoAllow(autoAllow);
	}

	/**
	 * Whether `newSession` can carry the saved model / effort as session
	 * inputs (Kiro CLI V3). When true, callers skip the post-create restore
	 * for those options. See kiro-v3.ts `acceptsInitialConfigPicks`.
	 */
	acceptsInitialConfigPicks(): boolean {
		return acceptsInitialConfigPicks(this.currentConfig);
	}

	/**
	 * Whether loaded and forked sessions keep their own model, effort and
	 * mode on the server (Kiro CLI V3). When true, callers don't re-apply the
	 * user's last-used picks on load. See kiro-v3.ts `storesSessionConfig`.
	 */
	storesSessionConfig(): boolean {
		return storesSessionConfig(this.currentConfig);
	}

	/**
	 * Create a new chat session with the agent.
	 */
	async newSession(
		workingDirectory: string,
		initialPicks?: InitialConfigPicks,
	): Promise<SessionResult> {
		const connection = this.requireConnection();

		try {
			this.logger.log("Creating new session...");

			const response = await connection.agent.request(acp.methods.agent.session.new, {
				cwd: this.toSessionCwd(workingDirectory),
				mcpServers: [],
				// Kiro V3 selects the agent (and model/effort) per session.
				...kiroV3SessionMeta(this.currentConfig, initialPicks),
			});

			this.logger.log(
				`Created session: ${response.sessionId}`,
			);
			const result = AcpTypeConverter.toSessionResult(
				response.sessionId,
				response,
			);
			this.currentSessionId = result.sessionId;
			return result;
		} catch (error) {
			this.logger.error("New Session Error:", error);
			throw error;
		}
	}

	/**
	 * Close one session on the live process (`session/close`), freeing its
	 * resources without restarting the agent. Only call when the agent
	 * advertises it (`AgentCapabilities.closesSessions`). Rejects on failure;
	 * the caller decides the fallback (I210 respawns).
	 */
	async closeSession(sessionId: string): Promise<void> {
		const connection = this.requireConnection();
		await connection.agent.request(acp.methods.agent.session.close, {
			sessionId,
		});
		this.logger.log(`Closed session: ${sessionId}`);
		if (this.currentSessionId === sessionId) {
			this.currentSessionId = null;
		}
	}

	/**
	 * F15 — ask the agent for a one-off reply in a throwaway side session on
	 * the EXISTING connection (used for "Rename with AI").
	 *
	 * Isolation contract: `currentSessionId` is never touched; the side
	 * session's updates go only to a private tap (see
	 * `AcpHandler.registerSideSession`) and its permission requests are
	 * auto-denied. The side session is closed when the agent advertises
	 * `session/close`. On timeout the turn is cancelled and this rejects.
	 */
	async requestSideTitle(
		promptText: string,
		workingDirectory: string,
		options: { timeoutMs?: number } = {},
	): Promise<{ sessionId: string; text: string }> {
		const connection = this.requireConnection();
		const timeoutMs = options.timeoutMs ?? 60_000;

		const created = await connection.agent.request(
			acp.methods.agent.session.new,
			{ cwd: this.toSessionCwd(workingDirectory), mcpServers: [] },
		);
		const sideId = created.sessionId;
		this.logger.log(`Created side session: ${sideId}`);

		let text = "";
		const unregister = this.handler.registerSideSession(sideId, (t) => {
			text += t;
		});

		let timer: number | undefined;
		try {
			const timeout = new Promise<never>((_, reject) => {
				timer = window.setTimeout(
					() => reject(new Error("Side title request timed out")),
					timeoutMs,
				);
			});
			try {
				await Promise.race([
					connection.agent.request(acp.methods.agent.session.prompt, {
						sessionId: sideId,
						prompt: [{ type: "text", text: promptText }],
					}),
					timeout,
				]);
			} catch (error) {
				await connection.agent
					.notify(acp.methods.agent.session.cancel, {
						sessionId: sideId,
					})
					.catch(() => undefined);
				throw error;
			}
			return { sessionId: sideId, text };
		} finally {
			window.clearTimeout(timer);
			unregister();
			if (
				this.cachedInitResult?.agentCapabilities?.sessionCapabilities
					?.close !== undefined
			) {
				await connection.agent
					.request(acp.methods.agent.session.close, {
						sessionId: sideId,
					})
					.catch((e: unknown) =>
						this.logger.warn("Side session close failed:", e),
					);
			}
		}
	}

	/**
	 * Authenticate with the agent using a specific method.
	 */
	async authenticate(methodId: string): Promise<boolean> {
		const connection = this.requireConnection();

		try {
			await connection.agent.request(acp.methods.agent.authenticate, { methodId });
			this.logger.log("✅ authenticate ok:", methodId);
			return true;
		} catch (error: unknown) {
			this.logger.error("Authentication Error:", error);
			return false;
		}
	}

	/**
	 * Send a message to the agent in a specific session.
	 */
	async sendPrompt(
		sessionId: string,
		content: PromptContent[],
	): Promise<void> {
		const connection = this.requireConnection();

		this.handler.resetUpdateCount();
		this.recentStderr = "";

		try {
			// Convert domain PromptContent to ACP ContentBlock
			// I220: V3 drops resource_link blocks; adapt before converting.
			const acpContent = adaptPromptForEngine(this.currentConfig, content).map((c) =>
				AcpTypeConverter.toAcpContentBlock(c),
			);

			this.logger.log(
				`Sending prompt with ${content.length} content blocks`,
			);

			const promptResult = await connection.agent.request(acp.methods.agent.session.prompt, {
				sessionId: sessionId,
				prompt: acpContent,
			});

			this.logger.log(
				`Agent completed with: ${promptResult.stopReason}`,
			);

			// Extract modelId from response metadata for header display (SDK 0.24+).
			const metaModelId = (promptResult._meta as Record<string, unknown> | undefined)?.modelId;
			if (typeof metaModelId === "string" && metaModelId) {
				this.handler.emitSessionUpdate({
					type: "model_update",
					sessionId,
					modelId: metaModelId,
				});
			}

			// Detect silent failures: agent returned end_turn but sent no content.
			// Only surface an error when stderr contains a recognized error pattern
			// (e.g., missing API key). Some commands like /compact legitimately
			// return no session updates, so we avoid false positives.
			if (
				!this.handler.hasReceivedUpdates() &&
				promptResult.stopReason === "end_turn"
			) {
				// Allow pending stderr data events to flush before checking
				await new Promise((r) => window.setTimeout(r, 100));

				const stderrHint = extractStderrErrorHint(this.recentStderr);
				if (stderrHint) {
					this.logger.warn(
						"Agent returned end_turn with no session updates — detected error in stderr",
					);
					throw new Error(
						`The agent returned an empty response. ${stderrHint}`,
					);
				} else {
					this.logger.log(
						"Agent returned end_turn with no session updates (may be expected for some commands)",
					);
				}
			}
		} catch (error: unknown) {
			if (isEmptyResponseError(error) || isUserAbortedError(error)) {
				return;
			}
			this.logger.error("Prompt Error:", error);
			throw error;
		}
	}

	/**
	 * Cancel the current operation in a session.
	 */
	async cancel(sessionId: string): Promise<void> {
		if (!this.connection) {
			this.cancelAllOperations();
			return;
		}
		try {
			this.logger.log(
				"Sending session/cancel notification...",
			);
			await this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId });
			this.logger.log(
				"Cancellation request sent successfully",
			);
		} catch (error) {
			this.logger.warn("Failed to send cancellation:", error);
		} finally {
			this.cancelAllOperations();
		}
	}

	/**
	 * Watch an ACP connection's `closed` promise. When it settles (the
	 * connection ended for any reason) reap the associated child process so a
	 * still-running agent blocked on stdin can't linger (#286).
	 */
	private watchConnectionClosed(
		connection: { closed: Promise<void> },
		agentProcess: ChildProcess,
	): void {
		const reap = () => this.reconcileProcessGone(agentProcess);
		connection.closed.then(reap, reap);
	}

	/**
	 * Reconcile client state after the agent process is gone or its ACP
	 * connection closed. Closes stdin (so a well-behaved agent gets EOF and
	 * exits), kills the process tree if still running, and clears connection
	 * state so the next reconnect starts clean. Guarded by process identity so
	 * a deliberate respawn/disconnect kill does not double-fire (#286).
	 */
	private reconcileProcessGone(agentProcess: ChildProcess): void {
		// Guard: ignore a superseded process — a deliberate respawn/disconnect
		// already replaced or cleared this.agentProcess, and its live
		// connection must not be torn down by the old process's late event.
		if (this.agentProcess !== agentProcess) return;

		this.logger.log(
			`Reaping agent process (PID ${agentProcess.pid}) after connection/process end`,
		);

		// I213: nobody can answer a dead process's permission requests or read
		// its terminals. Settle them so the dialog doesn't outlive the agent.
		this.cancelAllOperations();

		// Close stdin and kill the tree (I211: one shared teardown routine).
		// killProcessTree() nulls this.agentProcess.
		this.killProcessTree();

		// Clear connection state so the next reconnect starts clean.
		this.connection = null;
		this.isInitializedFlag = false;
		this.currentSessionId = null;
	}

	/** OS boundary for process teardown; overridden in tests. */
	private processOps: ProcessOps = nodeProcessOps;

	/** Teardowns still escalating in the background (I211). */
	private pendingTeardowns = new Set<Promise<void>>();

	/**
	 * Resolves once every background teardown (grace period, SIGKILL
	 * escalation, survivor check) has finished.
	 */
	whenTornDown(): Promise<void> {
		return Promise.all([...this.pendingTeardowns]).then(() => undefined);
	}

	/**
	 * Kill the agent process and its entire process tree. The single owner of
	 * agent teardown: disconnect, respawn, and the I194 reconcile path all
	 * come here.
	 *
	 * Unix: `teardownProcessTree` snapshots our tree, closes stdin, SIGTERMs
	 * our process group, and after a grace period SIGKILLs anything from the
	 * snapshot still alive — including MCP servers in their own process
	 * groups, which the group signal can't reach (I211). It runs in the
	 * background; client state is cleared immediately.
	 * Windows: closes stdin, then taskkill /T /F.
	 */
	private killProcessTree(): void {
		if (!this.agentProcess) return;

		const proc = this.agentProcess;
		const pid = proc.pid;
		this.agentProcess = null;
		this.logger.log(`Killing process tree (PID: ${pid})`);

		if (Platform.isWin || !pid) {
			try {
				proc.stdin?.end();
			} catch {
				// stdin may already be closed
			}
			try {
				if (pid) {
					spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
						stdio: "ignore",
					});
				} else {
					proc.kill();
				}
			} catch {
				// Process may already be dead
			}
			return;
		}

		const teardown = teardownProcessTree(
			{ pid, stdin: proc.stdin },
			this.processOps,
			this.logger,
		)
			.catch((error) => {
				this.logger.warn(`Teardown (PID ${pid}) failed:`, error);
			})
			.finally(() => {
				this.pendingTeardowns.delete(teardown);
			});
		this.pendingTeardowns.add(teardown);
	}

	/**
	 * The agent has a terminal that is still running (I209 `terminals` busy
	 * signal). The terminal map itself stays inside `acp/`.
	 */
	hasLiveTerminals(): boolean {
		return this.terminalManager.hasLiveTerminals();
	}

	/**
	 * Disconnect from the agent and clean up resources.
	 */
	disconnect(): Promise<void> {
		this.logger.log("Disconnecting...");

		// Cancel all pending operations
		this.cancelAllOperations();

		// Kill the agent process tree
		this.killProcessTree();

		// Clear connection and config references
		this.connection = null;
		this.currentConfig = null;

		// Reset initialization state
		this.isInitializedFlag = false;
		this.currentAgentId = null;
		this.currentSessionId = null;

		this.logger.log("Disconnected");
		return Promise.resolve();
	}

	/**
	 * Check if the agent connection is initialized and ready.
	 */
	isInitialized(): boolean {
		return (
			this.isInitializedFlag &&
			this.connection !== null &&
			this.agentProcess !== null
		);
	}

	/**
	 * The cached InitializeResult from the last successful initialize().
	 * Lets the restored-tab load path recover promptCapabilities the
	 * eager-init (Decision #10) discarded. Null before first init (I47).
	 */
	getInitializeResult(): InitializeResult | null {
		return this.cachedInitResult;
	}

	/**
	 * Get the ID of the currently connected agent.
	 */
	getCurrentAgentId(): string | null {
		return this.currentAgentId;
	}

	/**
	 * DEPRECATED: Use setSessionConfigOption instead.
	 */
	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		const connection = this.requireConnection();

		this.logger.log(
			`Setting session mode to: ${modeId} for session: ${sessionId}`,
		);

		try {
			await connection.agent.request(acp.methods.agent.session.setMode, {
				sessionId,
				modeId,
			});
			this.logger.log(`Session mode set to: ${modeId}`);
		} catch (error) {
			this.logger.error("Failed to set session mode:", error);
			throw error;
		}
	}

	/**
	 * Apply a model selection for a session.
	 *
	 * SDK 1.0 dropped the typed `session/set_model` wrapper (model selection was
	 * removed from the schema in 0.24 in favor of config options). However,
	 * agents that still report legacy model state — e.g. kiro-cli, which emits
	 * `models` in its session responses — continue to honor the raw
	 * `session/set_model` JSON-RPC method on the wire. Call it via the SDK's
	 * untyped request overload so those agents keep working. Agents that don't
	 * support it will reject with "Method not found", surfaced as an error.
	 */
	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		// Kiro CLI V3 rejects session/set_model; never put it on the wire.
		if (!allowsLegacySetModel(this.currentConfig)) {
			throw new Error(
				"session/set_model is not supported on Kiro CLI V3; use the model config option",
			);
		}
		const connection = this.requireConnection();

		this.logger.log(
			`Setting session model to: ${modelId} for session: ${sessionId}`,
		);

		try {
			await connection.agent.request<
				void,
				{ sessionId: string; modelId: string }
			>("session/set_model", { sessionId, modelId });
			this.logger.log(`Session model set to: ${modelId}`);
		} catch (error) {
			this.logger.error("Failed to set session model:", error);
			throw error;
		}
	}

	/**
	 * Set a session configuration option.
	 *
	 * Sends a config option change to the agent. The response contains the
	 * complete set of all config options with their current values, as changing
	 * one option may affect others.
	 */
	async setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string,
	): Promise<SessionConfigOption[]> {
		const connection = this.requireConnection();

		this.logger.log(
			`Setting config option: ${configId}=${value} for session: ${sessionId}`,
		);

		try {
			const response = await connection.agent.request(acp.methods.agent.session.setConfigOption, {
				sessionId,
				configId,
				value,
			});
			this.logger.log(
				`Config option set. Updated options:`,
				response.configOptions,
			);
			return AcpTypeConverter.toSessionConfigOptions(
				response.configOptions,
			);
		} catch (error) {
			this.logger.error(
				"Failed to set config option:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Register a callback to receive session updates from the agent.
	 *
	 * This unified callback receives all session update events:
	 * - agent_message_chunk: Text chunk from agent's response
	 * - agent_thought_chunk: Text chunk from agent's reasoning
	 * - tool_call: New tool call event
	 * - tool_call_update: Update to existing tool call
	 * - plan: Agent's task plan
	 * - available_commands_update: Slash commands changed
	 * - current_mode_update: Mode changed
	 */
	onSessionUpdate(callback: (update: SessionUpdate) => void): () => void {
		return this.handler.onSessionUpdate(callback);
	}

	/**
	 * Register a callback for MCP auth events (sign-in requests and server
	 * initialization from `_kiro.dev/mcp/*` extension notifications).
	 * Connection-scoped — not filtered by session id.
	 */
	onMcpAuthEvent(callback: (event: McpAuthEvent) => void): () => void {
		return this.handler.onMcpAuthEvent(callback);
	}

	/**
	 * V3: reconnect an MCP server with a fresh sign-in. The server then sends
	 * `_kiro/openExternalUrl`. Not advertised by the server (K7); the caller
	 * falls back to a plain notice when this rejects. Resolves once the server
	 * finishes the reset, which can take as long as the sign-in itself.
	 */
	async resetMcpServer(serverName: string): Promise<void> {
		if (this.currentConfig?.kiroEngine !== "v3") {
			throw new Error("MCP sign-in through resetServer needs the Kiro V3 engine");
		}
		const connection = this.requireConnection();
		await connection.agent.request(KIRO_MCP_RESET_SERVER_METHOD, {
			...(this.currentSessionId !== null && { sessionId: this.currentSessionId }),
			serverName,
			startOAuth: true,
		});
	}

	/**
	 * Respond to a permission request from the agent.
	 */
	respondToPermission(
		requestId: string,
		optionId: string,
		choice?: PermissionScopeChoice,
	): Promise<void> {
		this.requireConnection();

		this.logger.log(
			"Responding to permission request:",
			requestId,
			"with option:",
			optionId,
		);
		this.permissionManager.respond(requestId, optionId, choice);
		return Promise.resolve();
	}

	// Helper methods

	/**
	 * Assert that the ACP connection is initialized and return it.
	 * @throws Error if connection is not available
	 */
	private requireConnection(): acp.ClientConnection {
		if (!this.connection) {
			throw new Error(
				"Connection not initialized. Call initialize() first.",
			);
		}
		return this.connection;
	}

	/**
	 * Convert working directory to WSL path if in WSL mode on Windows.
	 */
	private toSessionCwd(cwd: string): string {
		if (Platform.isWin && this.plugin.settings.windowsWslMode) {
			return convertWindowsPathToWsl(cwd);
		}
		return cwd;
	}

	private cancelAllOperations(): void {
		this.permissionManager.cancelAll();
		this.terminalManager.killAllTerminals();
	}

	/**
	 * Get terminal output for UI rendering.
	 */
	getTerminalOutput(terminalId: string): Promise<TerminalOutputResult> {
		const result = this.terminalManager.getOutput(terminalId);
		if (!result) {
			throw new Error(`Terminal ${terminalId} not found`);
		}
		return Promise.resolve(result);
	}

	// ========================================================================
	// Session Management Methods
	// ========================================================================

	/**
	 * List available sessions (unstable).
	 *
	 * Only available if session.agentCapabilities.sessionCapabilities?.list is defined.
	 *
	 * @param cwd - Optional filter by working directory
	 * @param cursor - Pagination cursor from previous call
	 * @returns Promise resolving to sessions array and optional next cursor
	 */
	async listSessions(
		cwd?: string,
		cursor?: string,
	): Promise<ListSessionsResult> {
		const connection = this.requireConnection();

		try {
			this.logger.log("Listing sessions...");

			const filterCwd = cwd ? this.toSessionCwd(cwd) : undefined;

			const response = await connection.agent.request(acp.methods.agent.session.list, {
				cwd: filterCwd ?? null,
				cursor: cursor ?? null,
			});

			this.logger.log(
				`Found ${response.sessions.length} sessions`,
			);

			return {
				sessions: response.sessions.map((s) => ({
					sessionId: s.sessionId,
					cwd: s.cwd,
					title: s.title ?? undefined,
					updatedAt: s.updatedAt ?? undefined,
				})),
				nextCursor: response.nextCursor ?? undefined,
			};
		} catch (error) {
			this.logger.error("List Sessions Error:", error);
			throw error;
		}
	}

	/**
	 * Load a previous session with history replay (stable).
	 *
	 * Conversation history is received via onSessionUpdate callback
	 * as user_message_chunk, agent_message_chunk, tool_call, etc.
	 *
	 * @param sessionId - Session to load
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with modes and models
	 */
	async loadSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const connection = this.requireConnection();

		// Set sessionId before await so replay updates pass the sessionId filter
		this.currentSessionId = sessionId;

		try {
			this.logger.log(`Loading session: ${sessionId}...`);

			const response = await connection.agent.request(acp.methods.agent.session.load, {
				sessionId,
				cwd: this.toSessionCwd(cwd),
				mcpServers: [],
			});

			this.logger.log(`Session loaded: ${sessionId}`);
			const result = AcpTypeConverter.toSessionResult(
				sessionId,
				response,
			);
			this.currentSessionId = result.sessionId;
			return result;
		} catch (error) {
			this.logger.error("Load Session Error:", error);
			throw error;
		}
	}

	/**
	 * Resume a session without history replay (unstable).
	 *
	 * Use when client manages its own history storage.
	 *
	 * @param sessionId - Session to resume
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with modes and models
	 */
	async resumeSession(
		sessionId: string,
		cwd: string,
	): Promise<SessionResult> {
		const connection = this.requireConnection();

		// Set sessionId before await so any updates pass the sessionId filter
		this.currentSessionId = sessionId;

		try {
			this.logger.log(`Resuming session: ${sessionId}...`);

			const response = await connection.agent.request(acp.methods.agent.session.resume, {
				sessionId,
				cwd: this.toSessionCwd(cwd),
				mcpServers: [],
			});

			this.logger.log(`Session resumed: ${sessionId}`);
			const result = AcpTypeConverter.toSessionResult(
				sessionId,
				response,
			);
			this.currentSessionId = result.sessionId;
			return result;
		} catch (error) {
			this.logger.error("Resume Session Error:", error);
			throw error;
		}
	}

	/**
	 * Fork a session to create a new branch (unstable).
	 *
	 * Creates a new session with inherited context from the original.
	 *
	 * @param sessionId - Session to fork from
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with new sessionId
	 */
	async forkSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const connection = this.requireConnection();

		try {
			this.logger.log(`Forking session: ${sessionId}...`);

			const response = await connection.agent.request(acp.methods.agent.session.fork, {
				sessionId,
				cwd: this.toSessionCwd(cwd),
				mcpServers: [],
			});

			this.logger.log(
				`Session forked: ${sessionId} -> ${response.sessionId}`,
			);
			const result = AcpTypeConverter.toSessionResult(
				response.sessionId,
				response,
			);
			this.currentSessionId = result.sessionId;
			return result;
		} catch (error) {
			this.logger.error("Fork Session Error:", error);
			throw error;
		}
	}
}

/**
 * Every agent-to-client handler, registered on the app before `connect`, so
 * all of them exist before `initialize` is sent (the V3 guide requires this
 * for `_kiro/openExternalUrl`). An agent-to-client request with no handler
 * gets JSON-RPC `-32601` from the SDK (T9). Exported for the wiring tests.
 */
export function registerClientHandlers(
	app: acp.ClientApp,
	handler: AcpHandler,
): acp.ClientApp {
	return app
		.onNotification(acp.methods.client.session.update, (ctx) =>
			handler.sessionUpdate(ctx.params),
		)
		// kiro-cli ACP extension notifications (custom-method overload:
		// method string + params parser + handler). Without an explicit
		// registration the SDK silently drops them — which is exactly the
		// bug this fixes for MCP OAuth. See types/mcp-auth.ts.
		.onNotification(
			MCP_OAUTH_REQUEST_METHOD,
			parseMcpOauthRequest,
			(ctx) => handler.mcpOauthRequest(ctx.params),
		)
		.onNotification(
			MCP_SERVER_INITIALIZED_METHOD,
			parseMcpServerInitialized,
			(ctx) => handler.mcpServerInitialized(ctx.params),
		)
		.onRequest(acp.methods.client.session.requestPermission, (ctx) =>
			handler.requestPermission(ctx.params),
		)
		.onRequest(acp.methods.client.fs.readTextFile, (ctx) =>
			handler.readTextFile(ctx.params),
		)
		.onRequest(acp.methods.client.fs.writeTextFile, (ctx) =>
			handler.writeTextFile(ctx.params),
		)
		.onRequest(acp.methods.client.terminal.create, (ctx) =>
			handler.createTerminal(ctx.params),
		)
		.onRequest(acp.methods.client.terminal.output, (ctx) =>
			handler.terminalOutput(ctx.params),
		)
		.onRequest(acp.methods.client.terminal.waitForExit, (ctx) =>
			handler.waitForTerminalExit(ctx.params),
		)
		.onRequest(acp.methods.client.terminal.kill, (ctx) =>
			handler.killTerminal(ctx.params),
		)
		.onRequest(acp.methods.client.terminal.release, (ctx) =>
			handler.releaseTerminal(ctx.params),
		)
		// Kiro CLI V3 (S4): MCP status snapshots and sign-in page requests.
		.onNotification(KIRO_MCP_STATUS_METHOD, parseKiroMcpStatus, (ctx) =>
			handler.mcpStatus(ctx.params),
		)
		.onRequest(
			KIRO_OPEN_EXTERNAL_URL_METHOD,
			parseOpenExternalUrl,
			(ctx) => Promise.resolve(handler.openExternalUrl(ctx.params)),
		)
		// Kiro CLI V3 (S5): which shell our terminals use, for saved rules.
		.onRequest(
			KIRO_TERMINAL_SHELL_TYPE_METHOD,
			(params: unknown) => params,
			() => Promise.resolve(handler.terminalShellType()),
		);
}
