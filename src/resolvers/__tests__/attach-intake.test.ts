/**
 * deriveAttachIntake — the one decision for whether the composer takes files
 * right now ([[Agent Console Attachment Button]] § Resolvers, I319).
 *
 * Read by the attach button, the drop target, paste's file branch and the
 * attachment remove buttons, so they can't disagree. The tooltip halves are
 * part of the decision so the button's accessible name is pinned here:
 * open → "Attach files" (icon-only: the reason IS the name); disabled →
 * "Attach files" + separator + why.
 */
import { describe, expect, it } from "vitest";
import { deriveAttachIntake } from "../attach-intake";

const base = {
	showAttachButton: true,
	isQueued: false,
	attachedCount: 0,
	maxCount: 10,
};

describe("deriveAttachIntake", () => {
	it("hidden when the surface has no attach button (the landing)", () => {
		expect(
			deriveAttachIntake({ ...base, showAttachButton: false }),
		).toEqual({ kind: "hidden" });
		// Hidden wins over every other state.
		expect(
			deriveAttachIntake({
				...base,
				showAttachButton: false,
				isQueued: true,
				attachedCount: 10,
			}),
		).toEqual({ kind: "hidden" });
	});

	it("open: icon-only, so the label travels as the reason", () => {
		expect(deriveAttachIntake(base)).toEqual({
			kind: "open",
			tooltip: {
				visibleLabel: null,
				reason: { key: "chat.composer.attachFiles" },
			},
		});
		expect(deriveAttachIntake({ ...base, attachedCount: 9 }).kind).toBe(
			"open",
		);
	});

	it("locked while a message is queued (I319)", () => {
		expect(deriveAttachIntake({ ...base, isQueued: true })).toEqual({
			kind: "locked",
			tooltip: {
				visibleLabel: { key: "chat.composer.attachFiles" },
				reason: { key: "chat.composer.attachLockedReason" },
			},
		});
	});

	it("full at the limit, with the count as a param", () => {
		expect(deriveAttachIntake({ ...base, attachedCount: 10 })).toEqual({
			kind: "full",
			tooltip: {
				visibleLabel: { key: "chat.composer.attachFiles" },
				reason: {
					key: "chat.composer.attachFullReason",
					params: { count: 10 },
				},
			},
		});
		expect(deriveAttachIntake({ ...base, attachedCount: 12 }).kind).toBe(
			"full",
		);
	});

	it("queued and full → locked (the stronger reason: nothing may be added or removed)", () => {
		expect(
			deriveAttachIntake({ ...base, isQueued: true, attachedCount: 10 })
				.kind,
		).toBe("locked");
	});
});
