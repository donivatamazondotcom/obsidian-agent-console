/**
 * The a2ui context every message bubble receives (threaded through
 * MessageList from ChatPanel's useA2uiWiring). No React here, so hooks and
 * ui can both name it.
 */
import type { A2uiValidatedSurface } from "./types";
import type { A2uiButton } from "./action";
import type { A2uiDispatchOutcome } from "../session-dispatch-port";

/**
 * Everything the a2ui surface hosts need from the tab, threaded through
 * MessageList from ChatPanel. Tab turn state is NOT here: it changes on every
 * turn edge and this object reaches every bubble, so hosts read it from the
 * panel's A2UI turn store instead (I376). Optional on MessageBubbleProps: consumers that
 * don't wire it (exports, previews) render fences as ordinary markdown —
 * the T07 graceful-degradation path by construction.
 */
export interface A2uiBubbleContext {
	/** surfaceId → chosen componentId, derived from the transcript. */
	answers: ReadonlyMap<string, string>;
	/**
	 * First-valid-definition check (duplicate surfaceIds render inert). The
	 * site identifies WHICH fence asks: transcript message index + surface
	 * ordinal within the message (segmenter index).
	 */
	isFirstDefinition: (
		surfaceId: string,
		site: { messageIndex: number; surfaceIndex: number },
	) => boolean;
	/** The latest validly-defined surfaceId in the session (null = none). */
	latestSurfaceId: string | null;
	/** Build + dispatch the action; the outcome drives the pending lifecycle. */
	onActivate: (
		surface: A2uiValidatedSurface,
		button: A2uiButton,
	) => Promise<A2uiDispatchOutcome>;
}
