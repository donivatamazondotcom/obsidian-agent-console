/**
 * `deriveImageIntakeNotice` — what to tell the user when an image arrives
 * before the agent has said whether it takes images.
 *
 * `classifyImagePaste` (utils/image-paste.ts) returns `connecting` whenever
 * the image capability is unknown. That is true while the agent starts, after
 * the tab's agent was switched, and after the agent failed to start. The old
 * single notice ("paste the image again in a moment") was wrong for a drop or
 * a pick (it said "paste") and wrong after a failed start (waiting won't help).
 * See [[Agent Console Attachment Button]] § Resolvers.
 *
 * Total over every `TabSessionState`. In `idle`/`released` the connecting
 * copy is true because the attach intent has just started the connection
 * (`useLazySession.onAttachIntent`). Pure.
 */
import type { TranslationKey } from "../i18n";
import type { TabSessionState } from "../types/tab";

export interface ImageIntakeNoticeInput {
	/** Paste keeps its own wording; a drop or a pick is an "attach". */
	via: "paste" | "attach";
	lazyState: TabSessionState;
}

export function deriveImageIntakeNotice(
	input: ImageIntakeNoticeInput,
): TranslationKey {
	switch (input.lazyState) {
		case "error":
			return "notices.imageAttachAgentFailed";
		case "idle":
		case "released":
		case "connecting":
		case "ready":
		case "busy":
		case "permission":
			return input.via === "paste"
				? "notices.imagePasteConnecting"
				: "notices.imageAttachConnecting";
	}
}
