/**
 * Image-paste decision logic — pure, no React/Obsidian deps.
 *
 * Background (I72): a fresh chat tab derives image support from
 * `session.promptCapabilities?.image ?? false`. The `?? false` collapses two
 * distinct states:
 *   - **Unknown**     — `promptCapabilities` is undefined: the agent's ACP
 *     `initialize()` handshake hasn't resolved yet (the ~1-3s init window on a
 *     fresh tab). Transient.
 *   - **Unsupported** — `promptCapabilities.image === false`: the agent
 *     advertised no image support. Permanent.
 *
 * Treating both as "unsupported" misfires a permanent-sounding notice for a
 * sub-second timing state. `classifyImagePaste` separates them so the paste and
 * drop handlers can show an accurate transient message during the init window.
 */

/** Notice shown when an image is pasted/dropped before the agent's capabilities have loaded. */
export const IMAGE_PASTE_CONNECTING_NOTICE =
	"[Agent Console] Still connecting to the agent – paste the image again in a moment.";

/** Notice shown when the connected agent genuinely does not support image input. */
export const IMAGE_PASTE_UNSUPPORTED_NOTICE =
	"[Agent Console] This agent does not support image paste. Try drag & drop instead.";

/**
 * Outcome of classifying pasted/dropped image files against the agent's
 * (possibly not-yet-known) image capability.
 */
export type ImagePasteOutcome =
	/** Agent supports images → convert to base64 image attachments. */
	| "attach-as-image"
	/** Capabilities not loaded yet → show a transient notice, skip these images. */
	| "connecting"
	/**
	 * Capabilities known and images unsupported → try the resource_link
	 * fallback (works for path-bearing files); if it yields nothing (e.g. a
	 * clipboard bitmap with no path), show the unsupported notice.
	 */
	| "fallback-or-unsupported";

/**
 * Decide how to handle image files from a paste/drop, distinguishing
 * "capabilities not loaded yet" (transient) from "agent does not support
 * images" (permanent). See I72.
 */
export function classifyImagePaste(params: {
	supportsImages: boolean;
	imageCapabilityKnown: boolean;
}): ImagePasteOutcome {
	if (params.supportsImages) return "attach-as-image";
	if (!params.imageCapabilityKnown) return "connecting";
	return "fallback-or-unsupported";
}
