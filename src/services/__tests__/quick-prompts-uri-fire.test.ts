/**
 * A URI fire end to end, through `runUriFire` (what the protocol handler in
 * plugin.ts calls with the real rate-limit state, prompts and chat view):
 * cut-short notices, the not-ready notice and its retry, and the repeat
 * notice for a refused link.
 * Spec: [[Agent Console Fresh-Session Handoff]] T01, T02 (displayed notice
 * text), T08; [[I340 The repeat-link notice claims a tab that never opened]].
 *
 * Red-first: written before `runUriFire` and `uriCutShortNotice` existed.
 */
import { describe, it, expect, vi } from "vitest";
import {
	buildQuickPrompt,
	runUriFire,
	uriCutShortNotice,
	type UriFireDeps,
} from "../quick-prompts-logic";
import type { UriRateLimitState } from "../../utils/quick-prompt-uri";
import type { NewTabPromptOpts } from "../../types/quick-prompt";

const STRAY = (key: string) =>
	`This link has an unexpected part ("${key}"), so its text may be cut short by an & or # that wasn't encoded. Nothing was opened.`;
const STRAY_UNNAMED =
	"This link has an unexpected part, so its text may be cut short by an & or # that wasn't encoded. Nothing was opened.";
const HASH =
	"This link's text has a # that wasn't encoded, so part of it was cut off. Nothing was opened.";
const CRC =
	"This link's text doesn't match its check value, so part of it was lost or changed. Nothing was opened.";
const NOT_READY =
	"Agent Console wasn't ready, so the link opened nothing. Try the link again.";
const REPEAT = "That link was just used. Ignored the repeat.";
const TOO_FAST = "Links are opening too fast. Wait a moment and try again.";

describe("uriCutShortNotice (T01, T02 displayed text)", () => {
	it("uses the # wording for a fragment, not the key name", () => {
		expect(uriCutShortNotice("hash")).toBe(HASH);
	});

	it("names a stray key", () => {
		expect(uriCutShortNotice("stray-key", "B then C")).toBe(STRAY("B then C"));
	});

	it("cuts a long key to 40 code points without splitting an emoji", () => {
		const key = `${"x".repeat(39)}\u{1F642}tail that goes on`;
		expect(uriCutShortNotice("stray-key", key)).toBe(STRAY(`${"x".repeat(39)}\u{1F642}`));
	});

	it("strips a bidi override from the key", () => {
		expect(uriCutShortNotice("stray-key", "abc\u202Eevil")).toBe(STRAY("abcevil"));
	});

	it.each(["\u200B\u200B", "", "  "])("leaves out a key that is empty once cleaned (%j)", (key) => {
		expect(uriCutShortNotice("stray-key", key)).toBe(STRAY_UNNAMED);
	});

	it("uses the check-value wording for a crc failure", () => {
		expect(uriCutShortNotice("crc")).toBe(CRC);
	});
});

const PROMPT = buildQuickPrompt({
	path: "Quick Prompts/continue-handoff.md",
	basename: "continue-handoff",
	frontmatter: { "uri override": false },
	body: "Continue the work in the handoff below.\n\n{{selection}}",
});

/** The real deps plugin.ts passes, with a fake clock and chat view. */
function harness(opts: { strictKeys?: boolean } = {}) {
	let state: UriRateLimitState = {};
	let clock = 1_000_000;
	let mounted = true;
	const notify = vi.fn<(message: string) => void>();
	const openPromptInNewTab = vi.fn<(text: string, o: NewTabPromptOpts) => void>();
	const openChatView = vi.fn(async () => (mounted ? { openPromptInNewTab } : null));
	const deps: UriFireDeps = {
		rateLimit: {
			get: () => state,
			set: (s) => {
				state = s;
			},
		},
		now: () => clock,
		prompts: () => [PROMPT],
		strictKeys: opts.strictKeys ?? true,
		planContext: () => ({
			agents: [{ id: "test-claude", name: "Test Claude" }],
			defaultAgentId: "test-claude",
		}),
		openChatView,
		notify,
		logError: vi.fn(),
	};
	return {
		fire: (params: Record<string, string>) => runUriFire(params, deps),
		advance: (ms: number) => {
			clock += ms;
		},
		setMounted: (m: boolean) => {
			mounted = m;
		},
		state: () => state,
		now: () => clock,
		notify,
		openChatView,
		openPromptInNewTab,
	};
}

const LINK = {
	action: "agent-console",
	vault: "v",
	prompt: "continue-handoff",
};
/** "Fix A&B then C\nand ship #42 (today)", crc from Python's zlib.crc32. */
const TEXT = "Fix A&B then C\nand ship #42 (today)";
const TEXT_CRC = "23cf39ff";

describe("runUriFire (T08)", () => {
	it("a good crc link opens one staged tab with the handoff quoted", async () => {
		const h = harness();
		await h.fire({ ...LINK, crc: TEXT_CRC, selection: TEXT });
		expect(h.openPromptInNewTab).toHaveBeenCalledTimes(1);
		const [text, o] = h.openPromptInNewTab.mock.calls[0];
		expect(text).toContain("> Fix A&B then C\n> and ship #42 (today)");
		expect(o).toMatchObject({ send: false, foreground: true, suppressAutoContext: true });
		expect(h.notify).not.toHaveBeenCalled();
	});

	it("a stray-key link shows its notice, opens nothing, and moves the window", async () => {
		const h = harness();
		await h.fire({ ...LINK, selection: "Fix A", "B then C": "" });
		expect(h.notify).toHaveBeenCalledWith(STRAY("B then C"));
		expect(h.openChatView).not.toHaveBeenCalled();
		expect(h.openPromptInNewTab).not.toHaveBeenCalled();
		expect(h.state().lastAt).toBe(h.now());
	});

	it("a crc-mismatch link shows its notice, opens nothing, and moves the window", async () => {
		const h = harness();
		await h.fire({ ...LINK, crc: TEXT_CRC, selection: "Fix A" });
		expect(h.notify).toHaveBeenCalledWith(CRC);
		expect(h.openChatView).not.toHaveBeenCalled();
		expect(h.state().lastAt).toBe(h.now());
	});

	it("an unencoded # shows the # notice", async () => {
		const h = harness();
		await h.fire({ ...LINK, selection: "See issue ", hash: "42 then ship" });
		expect(h.notify).toHaveBeenCalledWith(HASH);
		expect(h.openChatView).not.toHaveBeenCalled();
	});

	it("with strict keys off, a stray key no longer blocks the link", async () => {
		const h = harness({ strictKeys: false });
		await h.fire({ ...LINK, selection: "Fix A", "B then C": "" });
		expect(h.openPromptInNewTab).toHaveBeenCalledTimes(1);
	});

	it("a chat view that never mounts shows the not-ready notice and opens no tab", async () => {
		const h = harness();
		h.setMounted(false);
		await h.fire({ ...LINK, crc: TEXT_CRC, selection: TEXT });
		expect(h.openChatView).toHaveBeenCalledTimes(1);
		expect(h.notify).toHaveBeenCalledWith(NOT_READY);
		expect(h.openPromptInNewTab).not.toHaveBeenCalled();
	});

	it("retrying the same link 3 s after not-ready goes through, not as a repeat", async () => {
		const h = harness();
		const link = { ...LINK, crc: TEXT_CRC, selection: TEXT };
		h.setMounted(false);
		await h.fire(link);
		h.setMounted(true);
		h.notify.mockClear();
		h.advance(3_000);
		await h.fire(link);
		expect(h.notify).not.toHaveBeenCalledWith(REPEAT);
		expect(h.openPromptInNewTab).toHaveBeenCalledTimes(1);
	});

	it("a retry within 2 s of not-ready is still rate limited", async () => {
		const h = harness();
		const link = { ...LINK, crc: TEXT_CRC, selection: TEXT };
		h.setMounted(false);
		await h.fire(link);
		h.setMounted(true);
		h.advance(1_000);
		await h.fire(link);
		expect(h.notify).toHaveBeenLastCalledWith(TOO_FAST);
		expect(h.openPromptInNewTab).not.toHaveBeenCalled();
	});
});

describe("I340: the repeat notice doesn't claim a tab opened", () => {
	it.each([
		["unknown prompt", { ...LINK, prompt: "test-nope" }],
		["cut-short link", { ...LINK, selection: "Fix A", "B then C": "" }],
	])("a refused %s fired again within 10 s gets the plain repeat wording", async (_n, link) => {
		const h = harness();
		await h.fire(link);
		h.advance(3_000);
		await h.fire(link);
		expect(h.notify).toHaveBeenLastCalledWith(REPEAT);
		expect(h.openPromptInNewTab).not.toHaveBeenCalled();
	});
});
