/**
 * Copy link to chat, from a tab's right-click menu ([[Agent Console Chat ID]]
 * D11, D16).
 *
 * - A chat with a recorded ID (`copyLinkResult`): copy `[<title>](<URI>)`,
 *   then confirm.
 * - A failed clipboard write: log it, then say so.
 * - No recorded ID yet: say to send a message first, and copy nothing.
 *
 * Focus then returns to the active tab's composer in every case, through the
 * focus resolver, as after Rename (TS-I09) and a quick prompt's Copy link
 * (I234). Shaped like `runChipCopy`: the clipboard, notices, logging and the
 * refocus scheduler are injected (the browser / Obsidian boundary), so the
 * outcomes are testable in jsdom.
 */
import { t } from "../i18n";
import { applyComposerFocus } from "../resolvers/composer-focus";
import { copyLinkResult } from "../resolvers/chat-target";
import type { SavedSessionInfo } from "../types/session";

export interface ChatLinkCopyInput {
	/** The tab's bound record ID (`getRecordIdForTab`), "" or null for none. */
	recordId: string | null;
	/** The saved history records, read at click time. */
	records: readonly SavedSessionInfo[];
	/** The tab's label, used as the link's text. */
	title: string;
	/** The vault's name, for the link's `vault=` value. */
	vaultName: string;
}

export interface ChatLinkCopyDeps {
	writeText: (text: string) => Promise<void>;
	notify: (message: string) => void;
	logError: (message: string, error: unknown) => void;
	/** Return focus to the active tab's composer. */
	refocus: () => void;
}

export type ChatLinkCopyOutcome = "copied" | "copy-failed" | "no-id";

export async function runChatLinkCopy(
	input: ChatLinkCopyInput,
	deps: ChatLinkCopyDeps,
): Promise<ChatLinkCopyOutcome> {
	try {
		const result = copyLinkResult(
			input.recordId,
			input.records,
			input.title,
			input.vaultName,
		);
		if (result.kind === "no-id") {
			deps.notify(t("notices.chatLinkSendFirst"));
			return "no-id";
		}
		try {
			await deps.writeText(result.markdown);
		} catch (error) {
			deps.logError("[ChatLink] copy link failed", error);
			deps.notify(t("notices.chatLinkCopyFailed"));
			return "copy-failed";
		}
		deps.notify(t("notices.chatLinkCopied"));
		return "copied";
	} finally {
		applyComposerFocus("copy-chat-link", {
			focusUnconditional: deps.refocus,
			focusGuarded: deps.refocus,
		});
	}
}
