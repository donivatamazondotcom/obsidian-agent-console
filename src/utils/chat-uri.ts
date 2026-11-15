/**
 * Chat links: `obsidian://agent-console-chat?vault=<vault>&id=<chat ID>`.
 * Build, parse and rate-limit them. Pure; no Obsidian imports. See
 * [[Agent Console Chat ID]].
 */

import type { ChatId } from "../types/session";
import { URI_RATE_LIMIT_MS } from "./quick-prompt-uri";

/** The protocol action registered with `registerObsidianProtocolHandler`. */
export const CHAT_LINK_ACTION = "agent-console-chat";

/**
 * `encodeURIComponent` plus the characters it leaves alone that would end a
 * Markdown link target early or read as a title: `(`, `)`, `!`, `'`, `*`.
 */
function encodeLinkPart(value: string): string {
	return encodeURIComponent(value).replace(
		/[()!'*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

export function buildChatUri(vault: string, id: ChatId): string {
	return `obsidian://${CHAT_LINK_ACTION}?vault=${encodeLinkPart(vault)}&id=${encodeLinkPart(id)}`;
}

/** Escape a link title so it stays one Markdown link: `\`, `[` and `]`. */
export function escapeLinkTitle(title: string): string {
	return title.replace(/[\\[\]]/g, (c) => `\\${c}`);
}

/** `[<title>](<chat link>)`, ready to paste into a note. */
export function buildChatLinkMarkdown(
	title: string,
	vault: string,
	id: ChatId,
): string {
	return `[${escapeLinkTitle(title)}](${buildChatUri(vault, id)})`;
}

export type ChatLinkParse =
	| { kind: "ok"; id: ChatId }
	| { kind: "bad-param"; field: "id" };

/**
 * Read the chat ID from the params Obsidian hands the handler (already
 * decoded). A missing, empty or whitespace-only `id` is a bad link.
 */
export function parseChatLinkParams(
	params: Readonly<Record<string, string | undefined>>,
): ChatLinkParse {
	const id = params.id;
	if (typeof id !== "string" || id.trim() === "") {
		return { kind: "bad-param", field: "id" };
	}
	return { kind: "ok", id };
}

export interface ChatLinkRateLimitState {
	lastAt?: number;
	lastId?: string;
}

export type ChatLinkRateLimitResult =
	| { ok: true; state: ChatLinkRateLimitState }
	| { ok: false; reason: "repeat" | "rate-limit" };

/**
 * Accept or reject a chat link (D14). Only the 2 s limit applies: clicking a
 * chat link again later to get back to the chat is normal. Within 2 s, the
 * same chat is a `repeat` (dropped silently, as from a double-click) and a
 * different chat is `rate-limit`. New state is returned only on acceptance,
 * so a rejected link never moves the window.
 */
export function checkChatLinkRateLimit(
	state: ChatLinkRateLimitState,
	id: string,
	now: number,
): ChatLinkRateLimitResult {
	if (state.lastAt !== undefined && now - state.lastAt < URI_RATE_LIMIT_MS) {
		return { ok: false, reason: id === state.lastId ? "repeat" : "rate-limit" };
	}
	return { ok: true, state: { lastAt: now, lastId: id } };
}
