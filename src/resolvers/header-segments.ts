/**
 * What the chat header shows, from the tab and its session (pure, total).
 *
 * ChatPanel calls this once per relevant change and hands the result to
 * ChatHeader. It used to be an inline memo body, where nothing could test
 * which field feeds `titleIsDefault`, which signal means "this is Kiro", or
 * whether a configured `--agent` is consulted for a non-Kiro tab (code review
 * round 1, T1).
 *
 * - Visible: the tab's title, then grey extras (`deriveHeaderExtras`).
 * - Tooltip: Chat, Agent, the I207 status line, Engine, Model, Effort, Mode,
 *   Folder (I247), each only when it applies.
 *
 * The Kiro signal is `session.kiroCli`, decided at the acp/ edge at
 * initialize — never the agent id or command. The caller resolves the
 * configured Kiro `--agent` from settings (`configuredKiroAgent`); it only
 * counts when the session is kiro-cli.
 *
 * Spec: [[Session Title in the Chat Header]].
 */
import type { ComposerPickers } from "./composer-pickers";
import {
	deriveConfirmedModelDiffers,
	deriveHeaderAgent,
	deriveHeaderEffort,
	deriveHeaderEngine,
	deriveHeaderFolder,
	deriveHeaderMode,
	deriveHeaderModelName,
	type HeaderAgent,
	type HeaderEngine,
} from "./header-agent";
import { deriveHeaderExtras, type HeaderExtras } from "./header-extras";
import type {
	AgentInfo,
	KiroEngineFallback,
	SessionConfigOption,
	SessionModelState,
	SessionModeState,
} from "../types/session";

/**
 * What the header title row shows: the chat's title, then grey extras —
 * only what the composer doesn't already show, plus the "agent didn't load"
 * warning. No lifecycle state: connecting / asleep live in the tab's status
 * icon. The other fields feed the hover tooltip.
 */
export interface HeaderSegments {
	/** The hosting tab's label — the chat's title. */
	title: string;
	/** The title is still the tab's default "<agent> <time>" name. */
	titleIsDefault: boolean;
	/** Grey text after the title (`deriveHeaderExtras`). */
	extras: HeaderExtras;
	/** Configured agent display name (e.g. "Auto SA"); tooltip Agent line. */
	profile: string;
	/** Engine the tab runs on (`deriveHeaderEngine`); tooltip only. */
	engine: HeaderEngine;
	/** Model display name (`deriveHeaderModelName`); tooltip Model line. */
	model: string | null;
	/** Current effort level name (`deriveHeaderEffort`); tooltip only. */
	effort: string | null;
	/** Current mode name, non-Kiro agents only (`deriveHeaderMode`); tooltip only. */
	mode: string | null;
	/** The tab's folder (`deriveHeaderFolder`); tooltip only. */
	folder: string | null;
	/**
	 * Session acquisition is in flight (lazySession.state === "connecting").
	 * The tooltip's Engine and Model lines read "Connecting…" meanwhile (I80).
	 */
	isConnecting?: boolean;
	/** Which agent is running vs the configured one (I207); tooltip status line. */
	agent?: HeaderAgent;
}

export interface HeaderSegmentsInput {
	/** The tab's label. */
	title: string;
	/** `TabInfo.labelIsDefault`. */
	titleIsDefault: boolean;
	/** The configured agent's display name. */
	profile: string;
	/** The tab's working folder (`agentCwd`). */
	cwd?: string;
	/** The Kiro `--agent` the configuration asks for, if any (from settings). */
	configuredKiroAgent?: string;
	/** `deriveComposerPickers` result — what the composer already shows. */
	composer: ComposerPickers;
	session: {
		kiroCli?: boolean;
		kiroEngine?: "v2" | "v3";
		kiroEngineFallback?: KiroEngineFallback;
		agentInfo?: AgentInfo;
		modes?: SessionModeState;
		models?: SessionModelState;
		configOptions?: SessionConfigOption[];
		confirmedModelId?: string;
		confirmedUnder?: string;
	};
}

export function deriveHeaderSegments(input: HeaderSegmentsInput): HeaderSegments {
	const { session } = input;
	const isKiro = session.kiroCli === true;

	const engine = deriveHeaderEngine({
		kiroCli: session.kiroCli,
		kiroEngine: session.kiroEngine,
		kiroEngineFallback: session.kiroEngineFallback,
		agentInfo: session.agentInfo,
	});
	const effort = deriveHeaderEffort({ configOptions: session.configOptions });
	const mode = deriveHeaderMode({
		kiroCli: session.kiroCli,
		modes: session.modes,
		configOptions: session.configOptions,
	});
	const folder = deriveHeaderFolder({ cwd: input.cwd });

	// Confirmed model while its selection is unchanged, then the `model`
	// config option, then legacy models (I258).
	const modelInput = {
		confirmedModelId: session.confirmedModelId,
		confirmedUnder: session.confirmedUnder,
		models: session.models,
		configOptions: session.configOptions,
	};
	const model = deriveHeaderModelName(modelInput);

	// I207: name the running agent when it isn't the configured one.
	const agent = deriveHeaderAgent({
		label: input.profile,
		requestedModeId: isKiro ? input.configuredKiroAgent : undefined,
		modes: session.modes,
		configOptions: session.configOptions,
	});

	const extras = deriveHeaderExtras({
		agent,
		model: { name: model, confirmedDiffers: deriveConfirmedModelDiffers(modelInput) },
		composer: input.composer,
		modesAreAgents: isKiro,
		titleIsDefault: input.titleIsDefault,
	});

	return {
		title: input.title,
		titleIsDefault: input.titleIsDefault,
		extras,
		profile: input.profile,
		engine,
		model,
		effort,
		mode,
		folder,
		agent,
	};
}
