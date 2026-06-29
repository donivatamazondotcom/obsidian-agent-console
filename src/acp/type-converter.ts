import * as acp from "@agentclientprotocol/sdk";
import type { ToolCallContent, PromptContent } from "../types/chat";
import type {
	InitializeResult,
	SessionConfigOption,
	SessionConfigSelectGroup,
	SessionConfigSelectOption,
	SessionResult,
	SlashCommand,
	RawAgentCapabilities,
	AgentCapabilities,
} from "../types/session";

/**
 * Common shape of ACP session responses.
 *
 * NewSessionResponse and ForkSessionResponse include sessionId.
 * LoadSessionResponse and ResumeSessionResponse do not (the sessionId
 * is the same as the request parameter). This interface captures the
 * shared fields for type-safe conversion; sessionId is optional here
 * and supplied explicitly when missing from the response.
 */
/**
 * Raw legacy model-state shape. Removed from the ACP SDK types in 0.24
 * (superseded by configOptions), but agents such as kiro-cli still emit it
 * on the wire in session responses, and the SDK passes the untyped field
 * through unchanged. Typed here as the raw shape so the converter can
 * re-surface it. See the "Restore Kiro Model Selection" spec.
 */
interface LegacyModelState {
	currentModelId: string;
	availableModels: Array<{
		modelId: string;
		name: string;
		description?: string | null;
	}>;
}

interface AcpSessionResponse {
	sessionId?: string;
	modes?: acp.SessionModeState | null;
	configOptions?: acp.SessionConfigOption[] | null;
	/**
	 * Legacy model state, untyped by the SDK since 0.24 but still emitted by
	 * some agents (e.g. kiro-cli). Surfaced via {@link LegacyModelState}.
	 */
	models?: LegacyModelState | null;
}

/**
 * Type converter between ACP Protocol types and Domain types.
 *
 * This adapter ensures the domain layer remains independent of the ACP library.
 * When the ACP protocol changes, only this converter needs to be updated.
 */
export class AcpTypeConverter {
	/**
	 * Convert ACP ToolCallContent to domain ToolCallContent.
	 *
	 * Filters out content types that are not supported by the domain model:
	 * - Supports: "diff", "terminal"
	 * - Ignores: "content" (not implemented in UI)
	 *
	 * @param acpContent - Tool call content from ACP protocol
	 * @returns Domain model tool call content, or undefined if input is null/empty
	 */
	/**
	 * Convert ACP AvailableCommand[] to domain SlashCommand[].
	 */
	static toSlashCommands(
		acpCommands: acp.AvailableCommand[] | undefined | null,
	): SlashCommand[] {
		return (acpCommands || []).map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			hint: cmd.input?.hint ?? null,
		}));
	}

	static toToolCallContent(
		acpContent: acp.ToolCallContent[] | undefined | null,
	): ToolCallContent[] | undefined {
		if (!acpContent) return undefined;

		const converted: ToolCallContent[] = [];

		for (const item of acpContent) {
			if (item.type === "diff") {
				converted.push({
					type: "diff",
					path: item.path,
					newText: item.newText,
					oldText: item.oldText,
				});
			} else if (item.type === "terminal") {
				converted.push({
					type: "terminal",
					terminalId: item.terminalId,
				});
			}
			// "content" type is intentionally ignored (not implemented in UI)
		}

		return converted.length > 0 ? converted : undefined;
	}

	/**
	 * Convert domain PromptContent to ACP ContentBlock.
	 *
	 * This converts our domain-layer prompt content to the ACP protocol format
	 * for sending to the agent.
	 *
	 * @param content - Domain prompt content (text, image, resource, or resource_link)
	 * @returns ACP ContentBlock for use with the prompt API
	 */
	/**
	 * Convert ACP SessionConfigOption[] to domain SessionConfigOption[].
	 *
	 * @param acpOptions - Config options from ACP protocol
	 * @returns Domain model config options
	 */
	static toSessionConfigOptions(
		acpOptions: acp.SessionConfigOption[],
	): SessionConfigOption[] {
		const result: SessionConfigOption[] = [];
		for (const opt of acpOptions) {
			// Domain models select-type config options only. Boolean config
			// options (added to the ACP schema after the domain type was
			// written) have no UI representation and are skipped, matching
			// pre-1.0 behavior where SessionConfigOption was select-only.
			if (opt.type !== "select") continue;
			result.push({
				id: opt.id,
				name: opt.name,
				description: opt.description ?? undefined,
				category: opt.category ?? undefined,
				type: "select",
				currentValue: opt.currentValue,
				options: this.toSessionConfigSelectOptions(opt.options),
			});
		}
		return result;
	}

	private static toSessionConfigSelectOptions(
		acpOptions: acp.SessionConfigSelectOptions,
	): SessionConfigSelectOption[] | SessionConfigSelectGroup[] {
		if (acpOptions.length === 0) return [];

		// Determine if grouped or flat by checking first element
		const first = acpOptions[0];
		if ("group" in first) {
			return (acpOptions as acp.SessionConfigSelectGroup[]).map((g) => ({
				group: g.group,
				name: g.name,
				options: g.options.map((o) => ({
					value: o.value,
					name: o.name,
					description: o.description ?? undefined,
				})),
			}));
		}

		return (acpOptions as acp.SessionConfigSelectOption[]).map((o) => ({
			value: o.value,
			name: o.name,
			description: o.description ?? undefined,
		}));
	}

	/**
	 * Convert ACP session response to domain SessionResult.
	 *
	 * Handles the modes/models/configOptions conversion that is common
	 * to newSession, loadSession, resumeSession, and forkSession responses.
	 *
	 * ACP uses `null` for absent optional fields, while domain uses `undefined`.
	 * This method normalizes that difference.
	 *
	 * @param sessionId - The session ID (from response or from request params)
	 * @param response - ACP session response (new/load/resume/fork)
	 * @returns Domain SessionResult
	 */
	static toSessionResult(
		sessionId: string,
		response: AcpSessionResponse,
	): SessionResult {
		let modes: SessionResult["modes"];
		if (response.modes) {
			modes = {
				availableModes: response.modes.availableModes.map((m) => ({
					id: m.id,
					name: m.name,
					description: m.description ?? undefined,
				})),
				currentModeId: response.modes.currentModeId,
			};
		}

		// Model state was dropped from the ACP SDK types in 0.24, but agents
		// such as kiro-cli still emit `models` on the wire in session responses
		// and the SDK passes the untyped field through. Re-surface it here —
		// validated at this trust boundary — so the model picker and header
		// model name work for those agents. Agents that don't send it (e.g.
		// Claude Code) leave `models` undefined; never coerce.
		let models: SessionResult["models"];
		const rawModels = response.models;
		if (
			rawModels &&
			Array.isArray(rawModels.availableModels) &&
			typeof rawModels.currentModelId === "string"
		) {
			models = {
				availableModels: rawModels.availableModels.map((m) => ({
					modelId: m.modelId,
					name: m.name,
					description: m.description ?? undefined,
				})),
				currentModelId: rawModels.currentModelId,
			};
		}

		const configOptions = response.configOptions
			? this.toSessionConfigOptions(response.configOptions)
			: undefined;

		return {
			sessionId,
			modes,
			models,
			configOptions,
		};
	}

	static toAcpContentBlock(content: PromptContent): acp.ContentBlock {
		switch (content.type) {
			case "text":
				return { type: "text", text: content.text };
			case "image":
				return {
					type: "image",
					data: content.data,
					mimeType: content.mimeType,
				};
			case "resource":
				return {
					type: "resource",
					resource: {
						uri: content.resource.uri,
						mimeType: content.resource.mimeType,
						text: content.resource.text,
					},
					annotations: content.annotations,
				};
			case "resource_link":
				return {
					type: "resource_link",
					uri: content.uri,
					name: content.name,
					mimeType: content.mimeType,
					size: content.size,
				};
		}
	}

	/**
	 * Normalize the raw ACP `initialize` capability bag into the uniform
	 * {@link AgentCapabilities} domain record.
	 *
	 * This is THE single anti-corruption boundary for agent-capability
	 * variance: every external shape difference (`undefined` sub-caps, present
	 * objects, absent bag) collapses here into total, explicit booleans. The
	 * rest of the app consumes the record and never re-reads the raw bag's
	 * session-capability shape nor branches on agent id.
	 *
	 * @param raw - Raw capabilities from {@link toInitializeResult}, or undefined
	 * @returns Normalized record (all-false when raw is absent)
	 */
	static toAgentCapabilities(
		raw: RawAgentCapabilities | undefined,
	): AgentCapabilities {
		const sessionCaps = raw?.sessionCapabilities;
		return {
			listsSessions: sessionCaps?.list !== undefined,
			restoresViaLoad: raw?.loadSession === true,
			restoresViaResume: sessionCaps?.resume !== undefined,
			forks: sessionCaps?.fork !== undefined,
			// ACP SDK 0.14.1 has no initialize-time model capability; this is
			// the single wire-point if that ever changes. See AgentCapabilities.
			reportsModels: false,
		};
	}

	/**
	 * Convert ACP InitializeResponse to domain InitializeResult.
	 */
	static toInitializeResult(
		initResult: acp.InitializeResponse,
	): InitializeResult {
		const promptCaps = initResult.agentCapabilities?.promptCapabilities;
		const mcpCaps = initResult.agentCapabilities?.mcpCapabilities;
		const sessionCaps = initResult.agentCapabilities?.sessionCapabilities;

		const agentCapabilities: RawAgentCapabilities = {
			loadSession: initResult.agentCapabilities?.loadSession ?? false,
			sessionCapabilities: sessionCaps
				? {
						resume: sessionCaps.resume ?? undefined,
						fork: sessionCaps.fork ?? undefined,
						list: sessionCaps.list ?? undefined,
					}
				: undefined,
			mcpCapabilities: mcpCaps
				? {
						http: mcpCaps.http ?? false,
						sse: mcpCaps.sse ?? false,
					}
				: undefined,
			promptCapabilities: {
				image: promptCaps?.image ?? false,
				audio: promptCaps?.audio ?? false,
				embeddedContext: promptCaps?.embeddedContext ?? false,
			},
		};

		return {
			protocolVersion: initResult.protocolVersion,
			authMethods: initResult.authMethods || [],
			promptCapabilities: {
				image: promptCaps?.image ?? false,
				audio: promptCaps?.audio ?? false,
				embeddedContext: promptCaps?.embeddedContext ?? false,
			},
			agentCapabilities,
			capabilities: this.toAgentCapabilities(agentCapabilities),
			agentInfo: initResult.agentInfo
				? {
						name: initResult.agentInfo.name,
						title: initResult.agentInfo.title ?? undefined,
						version: initResult.agentInfo.version ?? undefined,
					}
				: undefined,
		};
	}
}
