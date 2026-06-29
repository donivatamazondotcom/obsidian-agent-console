/**
 * ConfirmResetModal — render + callback tests.
 *
 * Verifies the confirm dialog shown before resetting the Obsidian system
 * prompt: it renders a title and two buttons, "Reset to defaults" fires the
 * onConfirm callback (and closes), and "Cancel" closes without confirming.
 *
 * Uses an inline `obsidian` mock that gives Modal a working `contentEl` plus
 * the Obsidian createEl/createDiv DOM augmentations (same approach as
 * settings-pane-reorg.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Obsidian DOM augmentation (createEl family) ─────────────────────────────
type ElOpts = { cls?: string | string[]; text?: string };
function applyOpts(el: HTMLElement, opts?: ElOpts) {
	if (!opts) return;
	if (opts.cls)
		el.classList.add(...(Array.isArray(opts.cls) ? opts.cls : [opts.cls]));
	if (opts.text != null) el.textContent = opts.text;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = HTMLElement.prototype as any;
if (!proto.createEl)
	proto.createEl = function (this: HTMLElement, tag: string, opts?: ElOpts) {
		const el = document.createElement(tag);
		applyOpts(el, opts);
		this.appendChild(el);
		return el;
	};
if (!proto.createDiv)
	proto.createDiv = function (this: HTMLElement, opts?: ElOpts) {
		return (
			this as unknown as { createEl: typeof proto.createEl }
		).createEl("div", opts);
	};
if (!proto.empty)
	proto.empty = function (this: HTMLElement) {
		while (this.firstChild) this.removeChild(this.firstChild);
	};

vi.mock("obsidian", () => {
	class Modal {
		contentEl: HTMLElement = document.createElement("div");
		constructor(public app: unknown) {}
		open() {
			(this as unknown as { onOpen?: () => void }).onOpen?.();
		}
		close() {
			(this as unknown as { onClose?: () => void }).onClose?.();
		}
	}
	class App {}
	return { App, Modal };
});

import { App } from "obsidian";
import { ConfirmResetModal } from "../ConfirmResetModal";

const buttons = (m: ConfirmResetModal): HTMLButtonElement[] =>
	Array.from(
		(
			m as unknown as { contentEl: HTMLElement }
		).contentEl.querySelectorAll("button"),
	);
const byText = (m: ConfirmResetModal, text: string): HTMLButtonElement =>
	buttons(m).find((b) => b.textContent === text)!;

beforeEach(() => vi.clearAllMocks());

describe("ConfirmResetModal", () => {
	it("renders a title and Cancel + Reset buttons", () => {
		const modal = new ConfirmResetModal(new App() as never, () => {});
		modal.open();
		const ce = (modal as unknown as { contentEl: HTMLElement }).contentEl;
		expect(ce.querySelector("h2")?.textContent).toBe(
			"Reset Obsidian system prompt?",
		);
		expect(buttons(modal).map((b) => b.textContent)).toEqual([
			"Cancel",
			"Reset to defaults",
		]);
	});

	it("the destructive action is styled mod-warning", () => {
		const modal = new ConfirmResetModal(new App() as never, () => {});
		modal.open();
		expect(byText(modal, "Reset to defaults").classList).toContain(
			"mod-warning",
		);
	});

	it("clicking 'Reset to defaults' fires onConfirm once", () => {
		const onConfirm = vi.fn();
		const modal = new ConfirmResetModal(new App() as never, onConfirm);
		modal.open();
		byText(modal, "Reset to defaults").click();
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("clicking 'Cancel' does NOT fire onConfirm", () => {
		const onConfirm = vi.fn();
		const modal = new ConfirmResetModal(new App() as never, onConfirm);
		modal.open();
		byText(modal, "Cancel").click();
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
