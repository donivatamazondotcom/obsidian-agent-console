/**
 * InputArea — the attach button and the one attach path it shares with drop
 * and paste ([[Agent Console Attachment Button]], I319).
 *
 * Renders the REAL InputArea inside a small stateful harness (so the parent's
 * attachment list behaves like ChatPanel's `useState`). Mocked only at
 * boundaries: the Electron host's file-path lookup (`utils/file-path`) and the
 * Obsidian stub. Every case asserts the exact attachment the agent will get,
 * for a pick AND for a drop of the same file.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import * as React from "react";
import { Notice } from "obsidian";

vi.mock("../../utils/file-path", () => ({
	getFilePathForFile: (file: File) =>
		(file as File & { __path?: string }).__path ?? "",
}));

import { InputArea, type InputAreaProps } from "../InputArea";
import type AgentClientPlugin from "../../plugin";
import type { IChatViewHost } from "../view-host";
import type { UseSuggestionsReturn } from "../../hooks/useSuggestions";
import type { AttachedFile } from "../../types/chat";
import { classifyFocusTarget } from "../composer-focus-tracker";

/** The Obsidian stub records every Notice (src/__test_stubs__/obsidian.ts). */
const notices = (Notice as unknown as { instances: Array<{ message: unknown }> })
	.instances;

beforeAll(() => {
	class IO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
		IO;
});

beforeEach(() => {
	notices.length = 0;
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const settingsSnapshot = { sendMessageShortcut: "enter" };

function makePlugin(): AgentClientPlugin {
	return {
		settings: { displaySettings: { showEmojis: false } },
		settingsService: {
			subscribe: () => () => {},
			getSnapshot: () => settingsSnapshot,
		},
		app: { vault: { getConfig: () => true } },
	} as unknown as AgentClientPlugin;
}

function closedSuggestions(): UseSuggestionsReturn {
	const closed = {
		isOpen: false,
		suggestions: [] as unknown[],
		selectedIndex: 0,
		createRow: null,
		updateSuggestions: () => undefined,
		close: () => undefined,
		selectSuggestion: (v: string) => ({ newText: v, newCursorPos: v.length }),
	};
	return {
		mentions: closed,
		commands: closed,
		quickPrompts: closed,
		activePicker: null,
	} as unknown as UseSuggestionsReturn;
}

type HarnessProps = Partial<InputAreaProps> & {
	initialFiles?: AttachedFile[];
	onList?: (files: AttachedFile[]) => void;
};

/** Holds the attachment list like ChatPanel does; reports every change. */
function Harness({ initialFiles = [], onList, ...overrides }: HarnessProps) {
	const [files, setFiles] = React.useState<AttachedFile[]>(initialFiles);
	const onChange = React.useCallback(
		(next: AttachedFile[]) => {
			setFiles(next);
			onList?.(next);
		},
		[onList],
	);
	return (
		<InputArea
			isSending={false}
			isSessionReady={true}
			lazyState="ready"
			isRestoringSession={false}
			agentLabel="Claude Code"
			availableCommands={[]}
			restoredMessage={null}
			suggestions={closedSuggestions()}
			plugin={makePlugin()}
			view={{} as IChatViewHost}
			onSendMessage={vi.fn(async () => undefined)}
			onStopGeneration={vi.fn(async () => undefined)}
			onRestoredMessageConsumed={() => undefined}
			supportsImages={true}
			imageCapabilityKnown={true}
			agentId="claude-code-acp"
			inputValue=""
			onInputChange={() => undefined}
			errorInfo={null}
			onClearError={() => undefined}
			agentUpdateNotification={null}
			onClearAgentUpdate={() => undefined}
			messages={[]}
			isActive={true}
			showAttachButton={true}
			{...overrides}
			attachedFiles={overrides.attachedFiles ?? files}
			onAttachedFilesChange={overrides.onAttachedFilesChange ?? onChange}
		/>
	);
}

// ---- files -----------------------------------------------------------------

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");

function diskFile(
	name: string,
	type: string,
	body: BlobPart = "hello",
	path = `/Users/me/${name}`,
): File {
	const f = new File([body], name, { type });
	(f as File & { __path?: string }).__path = path;
	return f;
}
const textFile = () => diskFile("notes.txt", "text/plain");
const pngFile = () => diskFile("shot.png", "image/png", PNG_BYTES);

const TEXT_EXPECTED = {
	kind: "file",
	name: "notes.txt",
	path: "/Users/me/notes.txt",
	mimeType: "text/plain",
	size: 5,
};
const PNG_INLINE_EXPECTED = { kind: "image", mimeType: "image/png", data: PNG_B64 };
const PNG_LINK_EXPECTED = {
	kind: "file",
	name: "shot.png",
	path: "/Users/me/shot.png",
	mimeType: "image/png",
	size: PNG_BYTES.length,
};

// ---- gestures ----------------------------------------------------------------

function q<T extends Element>(c: HTMLElement, sel: string): T {
	const el = c.querySelector(sel);
	expect(el, sel).not.toBeNull();
	return el as T;
}
const attachButton = (c: HTMLElement) =>
	q<HTMLButtonElement>(c, ".agent-client-attach-button");
const fileInput = (c: HTMLElement) =>
	q<HTMLInputElement>(c, "input.agent-client-attach-input");
const inputBox = (c: HTMLElement) => q<HTMLElement>(c, ".agent-client-chat-input-box");
const textarea = (c: HTMLElement) =>
	q<HTMLTextAreaElement>(c, "textarea.agent-client-chat-input-textarea");

async function pick(c: HTMLElement, files: File[]) {
	const input = fileInput(c);
	Object.defineProperty(input, "files", { value: files, configurable: true });
	await act(async () => {
		fireEvent.change(input);
	});
	await act(async () => {
		await new Promise((r) => window.setTimeout(r, 0));
	});
}

async function drop(c: HTMLElement, files: File[]) {
	await act(async () => {
		fireEvent.drop(inputBox(c), {
			dataTransfer: { files, types: ["Files"] },
		});
	});
	await act(async () => {
		await new Promise((r) => window.setTimeout(r, 0));
	});
}

async function pasteFiles(c: HTMLElement, files: File[]) {
	await act(async () => {
		fireEvent.paste(textarea(c), {
			clipboardData: {
				items: files.map((f) => ({
					kind: "file",
					type: f.type,
					getAsFile: () => f,
				})),
			},
		});
	});
	await act(async () => {
		await new Promise((r) => window.setTimeout(r, 0));
	});
}

const strip = ({ id: _id, ...rest }: AttachedFile) => rest;

/** Let mount effects (including the composer's activation focus) run. */
async function settle() {
	await act(async () => {
		await new Promise((r) => window.setTimeout(r, 50));
	});
}
const noticeTexts = () => notices.map((n) => String(n.message));

function renderHarness(props: HarnessProps = {}) {
	const lists: AttachedFile[][] = [];
	const utils = render(<Harness onList={(l) => lists.push(l)} {...props} />);
	const last = () => (lists.length ? lists[lists.length - 1] : []);
	return { ...utils, lists, last };
}

// ============================================================================

describe("attach button — picking attaches exactly what a drop attaches", () => {
	const cases: Array<{
		name: string;
		props: HarnessProps;
		file: () => File;
		expected: object;
	}> = [
		{ name: "text file", props: {}, file: textFile, expected: TEXT_EXPECTED },
		{
			name: "PNG, agent takes images → inline",
			props: { supportsImages: true },
			file: pngFile,
			expected: PNG_INLINE_EXPECTED,
		},
		{
			name: "PNG, agent doesn't take images → file link",
			props: { supportsImages: false, imageCapabilityKnown: true },
			file: pngFile,
			expected: PNG_LINK_EXPECTED,
		},
	];

	for (const tc of cases) {
		it(`pick: ${tc.name}`, async () => {
			const h = renderHarness(tc.props);
			await pick(h.container, [tc.file()]);
			expect(h.last().map(strip)).toEqual([tc.expected]);
		});
		it(`drop: ${tc.name}`, async () => {
			const h = renderHarness(tc.props);
			await drop(h.container, [tc.file()]);
			expect(h.last().map(strip)).toEqual([tc.expected]);
		});
	}

	it("picking the same file twice attaches it twice (the input resets)", async () => {
		const h = renderHarness();
		const f = textFile();
		await pick(h.container, [f]);
		expect(fileInput(h.container).value).toBe("");
		await pick(h.container, [f]);
		expect(h.last().map(strip)).toEqual([TEXT_EXPECTED, TEXT_EXPECTED]);
	});

	it("11 picked files → 10 attached and the limit notice", async () => {
		const h = renderHarness();
		const files = Array.from({ length: 11 }, (_, i) =>
			diskFile(`f${i}.txt`, "text/plain"),
		);
		await pick(h.container, files);
		expect(h.last()).toHaveLength(10);
		expect(noticeTexts()).toContain(
			"[Agent Console] Maximum 10 attachments allowed",
		);
	});
});

describe("image before the agent says whether it takes images", () => {
	it.each([
		["connecting", "[Agent Console] Still connecting to the agent – attach the image again in a moment."],
		["idle", "[Agent Console] Still connecting to the agent – attach the image again in a moment."],
		["error", "[Agent Console] The agent didn't start, so the image wasn't attached. Reload the chat, then try again."],
	] as const)("%s: pick and drop attach nothing and say why", async (lazyState, text) => {
		for (const gesture of [pick, drop]) {
			notices.length = 0;
			const h = renderHarness({
				supportsImages: false,
				imageCapabilityKnown: false,
				lazyState,
				isSessionReady: false,
			});
			await gesture(h.container, [pngFile()]);
			expect(h.last()).toEqual([]);
			expect(noticeTexts()).toEqual([text]);
			h.unmount();
		}
	});

	it("non-image files still attach while connecting", async () => {
		const h = renderHarness({
			supportsImages: false,
			imageCapabilityKnown: false,
			lazyState: "connecting",
			isSessionReady: false,
		});
		await pick(h.container, [textFile()]);
		expect(h.last().map(strip)).toEqual([TEXT_EXPECTED]);
	});
});

describe("queued message: nothing gets in or out (I319)", () => {
	const QUEUED_NOTICE =
		"[Agent Console] Wait for the queued message to send, then attach files.";

	it.each([
		["pick", pick],
		["drop", drop],
		["paste", pasteFiles],
	] as const)("%s while queued → no attachment, the queued notice", async (_n, gesture) => {
		const onAttachedFilesChange = vi.fn();
		const h = renderHarness({ isQueued: true, onAttachedFilesChange });
		await gesture(h.container, [textFile()]);
		expect(onAttachedFilesChange).not.toHaveBeenCalled();
		expect(noticeTexts()).toEqual([QUEUED_NOTICE]);
	});

	it("the remove × is aria-disabled and doesn't remove while queued", async () => {
		const onAttachedFilesChange = vi.fn();
		const h = renderHarness({
			isQueued: true,
			attachedFiles: [{ id: "a", ...TEXT_EXPECTED } as AttachedFile],
			onAttachedFilesChange,
		});
		const x = q<HTMLButtonElement>(h.container, ".agent-client-attachment-preview-remove");
		expect(x.getAttribute("aria-disabled")).toBe("true");
		await act(async () => {
			fireEvent.click(x);
		});
		expect(onAttachedFilesChange).not.toHaveBeenCalled();
	});

	it("an image still converting when the message gets queued is dropped with the notice", async () => {
		const h = renderHarness({ supportsImages: true });
		await act(async () => {
			fireEvent.drop(inputBox(h.container), {
				dataTransfer: { files: [pngFile()], types: ["Files"] },
			});
		});
		h.rerender(
			<Harness onList={(l) => h.lists.push(l)} supportsImages={true} isQueued={true} />,
		);
		await act(async () => {
			await new Promise((r) => window.setTimeout(r, 10));
		});
		expect(h.last()).toEqual([]);
		expect(noticeTexts()).toEqual([QUEUED_NOTICE]);
	});

	it("dragging over while queued doesn't light up the drop target", async () => {
		const h = renderHarness({ isQueued: true });
		await act(async () => {
			fireEvent.dragEnter(inputBox(h.container), {
				dataTransfer: { types: ["Files"] },
			});
		});
		expect(inputBox(h.container).classList.contains("agent-client-dragging-over")).toBe(false);
	});
});

describe("overlapping attaches keep every result", () => {
	it("a pick while an image drop is still converting keeps both", async () => {
		const h = renderHarness({ supportsImages: true });
		await act(async () => {
			fireEvent.drop(inputBox(h.container), {
				dataTransfer: { files: [pngFile()], types: ["Files"] },
			});
		});
		await pick(h.container, [textFile()]);
		await act(async () => {
			await new Promise((r) => window.setTimeout(r, 10));
		});
		expect(h.last().map(strip)).toEqual(
			expect.arrayContaining([TEXT_EXPECTED, PNG_INLINE_EXPECTED]),
		);
		expect(h.last()).toHaveLength(2);
	});

	it("an image still converting across an agent switch is dropped", async () => {
		const h = renderHarness({ supportsImages: true });
		await act(async () => {
			fireEvent.drop(inputBox(h.container), {
				dataTransfer: { files: [pngFile()], types: ["Files"] },
			});
		});
		h.rerender(
			<Harness onList={(l) => h.lists.push(l)} supportsImages={true} agentId="codex-acp" />,
		);
		await act(async () => {
			await new Promise((r) => window.setTimeout(r, 10));
		});
		expect(h.last()).toEqual([]);
	});
});

describe("attach intent starts the connection", () => {
	it("button click on an idle tab calls onAttachIntent before opening the picker", async () => {
		const order: string[] = [];
		const onAttachIntent = vi.fn(() => order.push("intent"));
		vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {
			order.push("picker");
		});
		const h = renderHarness({ lazyState: "idle", isSessionReady: false, onAttachIntent });
		await act(async () => {
			fireEvent.click(attachButton(h.container));
		});
		expect(order).toEqual(["intent", "picker"]);
	});

	it("a drop on an idle tab calls onAttachIntent", async () => {
		const onAttachIntent = vi.fn();
		const h = renderHarness({ lazyState: "idle", isSessionReady: false, onAttachIntent });
		await drop(h.container, [textFile()]);
		expect(onAttachIntent).toHaveBeenCalledTimes(1);
	});

	it.each([
		["queued", { isQueued: true }],
		["error", { lazyState: "error" as const, isSessionReady: false }],
	])("not while %s", async (_n, props) => {
		const onAttachIntent = vi.fn();
		vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
		const h = renderHarness({ ...props, onAttachIntent });
		await act(async () => {
			fireEvent.click(attachButton(h.container));
		});
		await drop(h.container, [textFile()]);
		expect(onAttachIntent).not.toHaveBeenCalled();
	});
});

describe("attach button — keyboard and accessible name", () => {
	it("is a native button in the focus cluster; the file input stays out of Tab order", () => {
		const h = renderHarness();
		const b = attachButton(h.container);
		expect(b.tagName).toBe("BUTTON");
		expect(b.getAttribute("type")).toBe("button");
		expect(classifyFocusTarget(b, textarea(h.container))).toBe("cluster");
		const input = fileInput(h.container);
		expect(input.tabIndex).toBe(-1);
		expect(input.getAttribute("aria-hidden")).toBe("true");
		expect(b.hasAttribute("title")).toBe(false);
	});

	it("open: named 'Attach files'; clicking opens the picker; a pick returns focus to the composer", async () => {
		const click = vi
			.spyOn(HTMLInputElement.prototype, "click")
			.mockImplementation(() => undefined);
		const h = renderHarness();
		const b = attachButton(h.container);
		expect(b.getAttribute("aria-label")).toBe("Attach files");
		expect(b.getAttribute("aria-disabled")).toBeNull();
		b.focus();
		await act(async () => {
			fireEvent.click(b);
		});
		expect(click).toHaveBeenCalledTimes(1);
		await pick(h.container, [textFile()]);
		expect(document.activeElement).toBe(textarea(h.container));
	});

	it("queued: focusable, aria-disabled, the reason in its name, and it doesn't open the picker", async () => {
		const click = vi
			.spyOn(HTMLInputElement.prototype, "click")
			.mockImplementation(() => undefined);
		const h = renderHarness({ isQueued: true });
		const b = attachButton(h.container);
		expect(b.disabled).toBe(false);
		expect(b.getAttribute("aria-disabled")).toBe("true");
		expect(b.getAttribute("aria-label")).toBe(
			"Attach files — Wait for the queued message to send",
		);
		await act(async () => {
			fireEvent.click(b);
		});
		expect(click).not.toHaveBeenCalled();
	});

	it("full: the reason names the limit", () => {
		const files = Array.from(
			{ length: 10 },
			(_, i) => ({ id: `f${i}`, ...TEXT_EXPECTED }) as AttachedFile,
		);
		const h = renderHarness({ attachedFiles: files });
		const b = attachButton(h.container);
		expect(b.getAttribute("aria-disabled")).toBe("true");
		expect(b.getAttribute("aria-label")).toBe(
			"Attach files — You can attach up to 10 files",
		);
	});

	it("no button when the surface hides it", () => {
		const h = renderHarness({ showAttachButton: false });
		expect(h.container.querySelector(".agent-client-attach-button")).toBeNull();
	});
});

describe("attachment remove buttons", () => {
	const two = [
		{ id: "a", ...TEXT_EXPECTED, name: "a.txt" } as AttachedFile,
		{ id: "b", ...TEXT_EXPECTED, name: "b.txt" } as AttachedFile,
	];
	const removes = (c: HTMLElement) =>
		Array.from(
			c.querySelectorAll<HTMLButtonElement>(".agent-client-attachment-preview-remove"),
		);

	it("names the file and sits in the focus cluster", () => {
		const h = renderHarness({ initialFiles: two });
		const [x] = removes(h.container);
		expect(x.getAttribute("aria-label")).toBe("Remove a.txt");
		expect(classifyFocusTarget(x, textarea(h.container))).toBe("cluster");
	});

	it("removing the first moves focus to the remaining ×; removing the last focuses the composer", async () => {
		const h = renderHarness({ initialFiles: two });
		await settle();
		removes(h.container)[0].focus();
		await act(async () => {
			fireEvent.click(removes(h.container)[0]);
		});
		const [left] = removes(h.container);
		expect(left.getAttribute("aria-label")).toBe("Remove b.txt");
		expect(document.activeElement).toBe(left);
		await act(async () => {
			fireEvent.click(left);
		});
		expect(document.activeElement).toBe(textarea(h.container));
	});

	it("a remove and an add in the same commit doesn't leave a stale marker that later steals focus", async () => {
		const outside = document.createElement("button");
		document.body.appendChild(outside);
		const h = renderHarness({ initialFiles: two });
		await settle();
		await act(async () => {
			fireEvent.click(removes(h.container)[0]);
			// A pick lands in the same commit as the remove.
			const input = fileInput(h.container);
			Object.defineProperty(input, "files", {
				value: [textFile()],
				configurable: true,
			});
			fireEvent.change(input);
		});
		await settle();
		outside.focus();
		// Later, a send clears the strip from outside.
		h.rerender(
			<Harness
				onList={(l) => h.lists.push(l)}
				attachedFiles={[]}
				onAttachedFilesChange={() => undefined}
			/>,
		);
		await settle();
		expect(document.activeElement).toBe(outside);
		outside.remove();
	});

	it("a clear from outside (send, flush) doesn't move focus", async () => {
		const outside = document.createElement("button");
		document.body.appendChild(outside);
		const h = render(
			<Harness attachedFiles={two} onAttachedFilesChange={() => undefined} />,
		);
		await settle();
		outside.focus();
		h.rerender(<Harness attachedFiles={[]} onAttachedFilesChange={() => undefined} />);
		await act(async () => {
			await new Promise((r) => window.setTimeout(r, 0));
		});
		expect(document.activeElement).toBe(outside);
		outside.remove();
	});
});

describe("composer rail — where the attach button lives", () => {
	it("sits in the composer rail beside the textarea, not in the toolbar", () => {
		const h = renderHarness();
		const b = attachButton(h.container);
		const rail = b.closest(".agent-client-composer-rail");
		expect(rail).not.toBeNull();
		const row = rail!.parentElement!;
		expect(row.classList.contains("agent-client-composer-row")).toBe(true);
		expect(row.querySelector(":scope > .agent-client-textarea-wrapper")).not.toBeNull();
		expect(b.closest(".agent-client-chat-input-actions")).toBeNull();
	});

	it("no rail at all when the surface hides the button (landing keeps a full-width textarea)", () => {
		const h = renderHarness({ showAttachButton: false });
		expect(h.container.querySelector(".agent-client-composer-rail")).toBeNull();
		expect(h.container.querySelector(".agent-client-textarea-wrapper")).not.toBeNull();
	});

	it("its tooltip opens to the left so it doesn't cover Send", async () => {
		const { setTooltip } = await import("obsidian");
		const h = renderHarness();
		const b = attachButton(h.container);
		expect(vi.mocked(setTooltip)).toHaveBeenCalledWith(b, "Attach files", {
			placement: "left",
		});
	});
});
