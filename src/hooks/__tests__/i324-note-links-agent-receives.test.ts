/**
 * I324 (review): the note links the agent RECEIVES point at the vault file.
 *
 * Drives the real chain from the options useChatActions builds to the prompt
 * handed to `AcpClient.sendPrompt`: useAgentMessages.sendMessage →
 * preparePrompt → buildContextBlocks / processNote. Asserts the URIs of a
 * pinned note (reference-only and the over-16,000-character link-only case),
 * an @-mention and the selection, in both prompt shapes (embedded resources
 * and text), plus Windows and WSL vault paths. Every send runs in a working
 * folder that isn't the vault root.
 *
 * [[I324 Note paths use the working folder instead of the vault root]].
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Platform } from "obsidian";

import { useAgentMessages } from "../useAgentMessages";
import type { PromptContent } from "../../types/chat";

type AMParams = Parameters<typeof useAgentMessages>;

const NOTE = "Projects/Plan.md";
const BIG = "Projects/Big.md";
const big = "x".repeat(16_001);

function mount(opts: { embedded: boolean; wsl?: boolean }) {
	const sent: PromptContent[][] = [];
	const agentClient = {
		sendPrompt: vi.fn(async (_sid: string, content: PromptContent[]) => {
			sent.push(content);
		}),
	} as unknown as AMParams[0];
	const settingsAccess = {
		getSnapshot: () => ({ titleStrategy: "off", windowsWslMode: opts.wsl === true }),
	} as unknown as AMParams[1];
	const files = [
		{ path: NOTE, basename: "Plan", extension: "md", stat: { mtime: 0 } },
		{ path: BIG, basename: "Big", extension: "md", stat: { mtime: 0 } },
	];
	const vaultAccess = {
		getAllFiles: () => files,
		readNote: vi.fn(async (path: string) =>
			path === BIG ? big : "line one\nline two\nline three",
		),
	} as unknown as AMParams[2];
	const session = {
		sessionId: "s1",
		promptCapabilities: { embeddedContext: opts.embedded },
		authMethods: [],
	} as unknown as AMParams[3];
	const hook = renderHook(() =>
		useAgentMessages(agentClient, settingsAccess, vaultAccess, session, vi.fn()),
	);
	return { ...hook, sent };
}

/** The @-mention blocks: embedded resources at priority 1, or the mention wrapper. */
function mentionUris(content: PromptContent[]): string[] {
	const out: string[] = [];
	for (const b of content) {
		if (b.type === "resource" && b.annotations?.priority === 1) out.push(b.resource.uri);
		if (b.type === "text") {
			const m = b.text.match(/^<obsidian_mentioned_note ref="([^"]+)">/);
			if (m) out.push(m[1]);
		}
	}
	return out;
}

/** Every file URI in the prompt: resource and link URIs, and `ref="…"` attributes. */
function uris(content: PromptContent[]): string[] {
	const out: string[] = [];
	for (const b of content) {
		if (b.type === "resource_link") out.push(b.uri);
		if (b.type === "resource") out.push(b.resource.uri);
		if (b.type === "text") {
			for (const m of b.text.matchAll(/(?:ref|uri)="(file:[^"]+)"/g)) out.push(m[1]);
			for (const m of b.text.matchAll(/\((file:\/\/[^)\s]+)\)/g)) out.push(m[1]);
		}
	}
	return out;
}

async function send(
	hook: ReturnType<typeof mount>,
	vaultBasePath: string,
	/** The chat's working folder: never the vault root here (I324). */
	workingDirectory: string,
	text = "summarize @[[Plan]]",
) {
	await act(async () => {
		await hook.result.current.sendMessage(text, {
			vaultBasePath,
			workingDirectory,
			vaultRootPath: vaultBasePath,
			contextNotes: [
				{ path: NOTE, source: "user", seen: false, hydrated: true },
				{ path: BIG, source: "user", seen: false, hydrated: false },
			],
			selection: { path: NOTE, fromLine: 0, toLine: 1 },
		});
	});
	expect(hook.sent).toHaveLength(1);
	// The @-mention really ran (one block), so its link is checked too.
	expect(mentionUris(hook.sent[0])).toHaveLength(1);
	return uris(hook.sent[0]);
}

const platform = Platform as unknown as { isWin?: boolean };
beforeEach(() => {
	platform.isWin = false;
});

describe("I324: note links the agent receives", () => {
	for (const embedded of [true, false]) {
		const shape = embedded ? "embedded resources" : "text blocks";

		it(`${shape}: every note link starts at the vault root`, async () => {
			const hook = mount({ embedded });
			const got = await send(hook, "/vault", "/work/repo");

			expect(got.length).toBeGreaterThan(0);
			expect(got).toContain("file:///vault/Projects/Plan.md");
			// The over-16,000-character note goes as a link only.
			expect(got).toContain("file:///vault/Projects/Big.md");
			for (const u of got) expect(u.startsWith("file:///vault/")).toBe(true);
		});

		it(`${shape}: a Windows vault gets file:///C:/ links`, async () => {
			platform.isWin = true;
			const hook = mount({ embedded });
			const got = await send(hook, "C:\\Users\\me\\vault", "D:\\work\\repo");

			expect(got).toContain("file:///C:/Users/me/vault/Projects/Big.md");
			for (const u of got) expect(u.startsWith("file:///C:/Users/me/vault/")).toBe(true);
		});

		it(`${shape}: WSL mode links to /mnt/c paths`, async () => {
			platform.isWin = true;
			const hook = mount({ embedded, wsl: true });
			const got = await send(hook, "C:\\Users\\me\\vault", "D:\\work\\repo");

			expect(got).toContain("file:///mnt/c/Users/me/vault/Projects/Big.md");
			for (const u of got) expect(u.startsWith("file:///mnt/c/Users/me/vault/")).toBe(true);
		});
	}
});
