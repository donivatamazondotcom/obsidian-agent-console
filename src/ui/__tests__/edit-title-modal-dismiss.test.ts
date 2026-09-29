/**
 * EditTitleModal dismiss callback (TS-I09 follow-up).
 *
 * Cancelling a tab rename (Escape, Cancel button) must also return focus to
 * the composer, same as saving. The modal is shared with session-history
 * rename, so the hook is an OPTIONAL `onDismiss` that fires only when the
 * modal closes WITHOUT saving; callers that don't pass it keep today's
 * behavior.
 *
 * Reproduce-first: on `e6e742e` EditTitleModal takes no onDismiss → red.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => {
	class Modal {
		app: unknown;
		contentEl: HTMLElement;
		constructor(app: unknown) {
			this.app = app;
			this.contentEl = document.createElement("div");
			(this.contentEl as HTMLElement & { empty: () => void }).empty =
				function (this: HTMLElement) {
					this.replaceChildren();
				};
		}
		open() {
			(this as unknown as { onOpen: () => void }).onOpen();
		}
		close() {
			(this as unknown as { onClose: () => void }).onClose();
		}
	}
	class Notice {}
	return {
		Modal,
		Notice,
		App: class {},
		setIcon: vi.fn(),
		setTooltip: vi.fn(),
	};
});

import { EditTitleModal } from "../SessionHistoryModal";
import type { App } from "obsidian";

function open(onDismiss?: () => void) {
	const onSave = vi.fn();
	const modal = new EditTitleModal({} as App, "Old", onSave, onDismiss);
	modal.open();
	const input = modal.contentEl.querySelector("input")!;
	const [cancelBtn, saveBtn] = Array.from(
		modal.contentEl.querySelectorAll("button"),
	);
	return { modal, onSave, input, cancelBtn, saveBtn };
}

describe("EditTitleModal onDismiss (TS-I09)", () => {
	it("fires onDismiss when closed without saving (Escape / X)", () => {
		const onDismiss = vi.fn();
		const { modal, onSave } = open(onDismiss);
		modal.close();
		expect(onDismiss).toHaveBeenCalledOnce();
		expect(onSave).not.toHaveBeenCalled();
	});

	it("fires onDismiss from the Cancel button", () => {
		const onDismiss = vi.fn();
		const { cancelBtn } = open(onDismiss);
		cancelBtn.click();
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("does NOT fire onDismiss when the title is saved", () => {
		const onDismiss = vi.fn();
		const { input, onSave } = open(onDismiss);
		input.value = "New";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		expect(onSave).toHaveBeenCalledWith("New");
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("works without onDismiss (session-history callers unchanged)", () => {
		const { modal } = open();
		expect(() => modal.close()).not.toThrow();
	});
});
