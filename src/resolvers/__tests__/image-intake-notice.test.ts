/**
 * deriveImageIntakeNotice — which notice to show when an image arrives before
 * the agent has said whether it takes images
 * ([[Agent Console Attachment Button]] § Resolvers). Total over every
 * TabSessionState and both ways in.
 */
import { describe, expect, it } from "vitest";
import { deriveImageIntakeNotice } from "../image-intake-notice";
import type { TabSessionState } from "../../types/tab";

const notError: TabSessionState[] = [
	"idle",
	"released",
	"connecting",
	"ready",
	"busy",
	"permission",
];

describe("deriveImageIntakeNotice", () => {
	it("error → the agent didn't start; reload (both ways in)", () => {
		expect(
			deriveImageIntakeNotice({ via: "attach", lazyState: "error" }),
		).toBe("notices.imageAttachAgentFailed");
		expect(
			deriveImageIntakeNotice({ via: "paste", lazyState: "error" }),
		).toBe("notices.imageAttachAgentFailed");
	});

	it.each(notError)("%s, paste → the existing paste copy", (lazyState) => {
		expect(deriveImageIntakeNotice({ via: "paste", lazyState })).toBe(
			"notices.imagePasteConnecting",
		);
	});

	it.each(notError)(
		"%s, attach (drop or pick) → the attach copy, not 'paste'",
		(lazyState) => {
			expect(deriveImageIntakeNotice({ via: "attach", lazyState })).toBe(
				"notices.imageAttachConnecting",
			);
		},
	);
});
