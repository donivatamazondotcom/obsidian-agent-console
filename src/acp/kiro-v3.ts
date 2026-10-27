/**
 * Kiro CLI V3 adapter helpers (ACP boundary).
 *
 * kiro-cli ships two ACP server generations that both negotiate protocol
 * version 1, so the generation is chosen by the user's engine setting and
 * never inferred from the wire. Everything v3-specific about launching and
 * opening sessions lives here as pure functions; `AcpClient` only calls them.
 *
 * v3 differences handled here (CLI V3 ACP migration guide, 2026-10-09):
 * - Launch with `acp --agent-engine=v3`; v3 rejects `--agent`, `--model`,
 *   `--effort`, `--trust-all-tools` and `--trust-tools`.
 * - Agent, model and effort are session inputs (`_meta.kiro.modeId`,
 *   `modelId`, `effortLevel`), so values from the stripped flags are carried
 *   into `session/new`.
 * - Agent hooks run over ACP only when the client advertises
 *   `clientCapabilities._meta.kiro.hooks = {enabled: true, v2: true}`
 *   (verified on kiro-cli 2.34.2-nightly.1).
 *
 * Spec: [[Kiro CLI V3 Support]].
 */
import type * as acp from "@agentclientprotocol/sdk";
import type { AgentConfig } from "./acp-client";

export type KiroEngine = "v2" | "v3";

/** Initial session values v3 accepts under `_meta.kiro` on `session/new`. */
export interface KiroV3SessionMeta {
	modeId?: string;
	modelId?: string;
	effortLevel?: string;
}

export interface KiroV3Launch {
	args: string[];
	sessionMeta: KiroV3SessionMeta;
	/** The v2-only flags that were removed (for one log line). */
	stripped: string[];
}

/** v2-only flags v3 rejects. `value` = the flag takes an argument. */
const V2_ONLY_FLAGS: Record<string, { value: boolean; meta?: keyof KiroV3SessionMeta }> = {
	"--agent": { value: true, meta: "modeId" },
	"--model": { value: true, meta: "modelId" },
	"--effort": { value: true, meta: "effortLevel" },
	"--trust-all-tools": { value: false },
	"--trust-tools": { value: true },
};
const ENGINE_FLAG = "--agent-engine";

/**
 * True when an agent command is a kiro-cli binary (any path, `.exe` allowed).
 * Used only to decide whether to SHOW the engine setting on a custom agent;
 * the launch behavior follows the saved setting, never the command.
 */
export function isKiroCliCommand(command: string): boolean {
	const base = command.trim().split(/[\\/]/).pop() ?? "";
	const name = base.toLowerCase().replace(/\.exe$/, "");
	return name === "kiro-cli" || name === "kiro-cli-chat";
}

/** Total reader for the Kiro engine setting. Unknown values mean v2. */
export function resolveKiroEngine(settings: { engine?: unknown }): KiroEngine {
	return settings.engine === "v3" ? "v3" : "v2";
}

/**
 * Rewrite user-configured kiro-cli args for the v3 server. Pure and total.
 */
export function prepareKiroV3Launch(userArgs: readonly string[]): KiroV3Launch {
	const out: string[] = [];
	const sessionMeta: KiroV3SessionMeta = {};
	const stripped: string[] = [];

	for (let i = 0; i < userArgs.length; i++) {
		const arg = userArgs[i];
		const eq = arg.indexOf("=");
		const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
		const inline = arg.startsWith("--") && eq > 0 ? arg.slice(eq + 1) : undefined;

		if (name === ENGINE_FLAG) {
			if (inline === undefined) i++; // drop "--agent-engine <value>"
			continue;
		}
		const spec = V2_ONLY_FLAGS[name];
		if (!spec) {
			out.push(arg);
			continue;
		}
		let value = inline;
		if (spec.value && value === undefined && i + 1 < userArgs.length) {
			value = userArgs[++i];
		}
		if (spec.meta && value) sessionMeta[spec.meta] = value;
		stripped.push(name);
	}

	const acpIndex = out.indexOf("acp");
	const engineArg = `${ENGINE_FLAG}=v3`;
	if (acpIndex >= 0) out.splice(acpIndex + 1, 0, engineArg);
	else out.push(engineArg);

	return { args: out, sessionMeta, stripped };
}

/**
 * The agent a kiro-cli configuration asks for (the `--agent` value), on
 * either engine. Used by the header to tell "running the configured agent"
 * from "fell back" (I207). Undefined when no agent is named.
 */
export function requestedKiroAgent(args: readonly string[]): string | undefined {
	return prepareKiroV3Launch(args).sessionMeta.modeId;
}

/** Spawn args for a config: v3 configs are rewritten, everything else untouched. */
export function resolveLaunchArgs(config: AgentConfig): string[] {
	return config.kiroEngine === "v3"
		? prepareKiroV3Launch(config.args).args
		: [...config.args];
}

/**
 * `initialize` client capabilities. `baseMeta` carries the client's own
 * `_meta` entries (the a2ui binding); the v2 shape is otherwise unchanged.
 */
export function buildClientCapabilities(
	config: AgentConfig,
	baseMeta: Record<string, unknown> = {},
): acp.ClientCapabilities {
	const meta: Record<string, unknown> = { ...baseMeta };
	if (config.kiroEngine === "v3") {
		// Without this, the v3 server runs no agent hooks over ACP. `v2: true`
		// means "the server runs them"; `{enabled: true}` alone would make the
		// client responsible for running hooks (the Kiro IDE model).
		meta.kiro = { hooks: { enabled: true, v2: true } };
	}
	return {
		fs: { readTextFile: false, writeTextFile: false },
		terminal: true,
		_meta: meta,
	};
}

/** Extra `session/new` params for a v3 config (empty object otherwise). */
export function kiroV3SessionMeta(
	config: AgentConfig | null,
): { _meta?: { kiro: KiroV3SessionMeta } } {
	if (config?.kiroEngine !== "v3") return {};
	const sessionMeta = prepareKiroV3Launch(config.args).sessionMeta;
	return Object.keys(sessionMeta).length > 0
		? { _meta: { kiro: sessionMeta } }
		: {};
}
