/**
 * Chip context-menu copy actions: Copy prompt and Copy link.
 *
 * I234: after either copy, focus returns to the active tab's composer, the same
 * way a chip fire does (QP-I20). The menu was opened from a chip, so without
 * this the user has to click back into the composer to keep typing. Focus
 * returns on success AND on a failed clipboard write.
 *
 * Clipboard, notices and the refocus are injected (the browser / Obsidian
 * boundary) so the dispatch is testable in jsdom.
 * Spec: [[Agent Console Quick Prompt URIs]] § Copy link.
 */
import { t } from "../i18n";
import { buildPromptUri } from "../utils/quick-prompt-uri";
import type { QuickPrompt } from "../types/quick-prompt";

export interface ChipCopyDeps {
	writeText: (text: string) => Promise<void>;
	notify: (message: string) => void;
	logError: (message: string, error: unknown) => void;
	/** Name of the vault, for the link's `vault=` value. */
	vaultName: string;
	/** Return focus to the active tab's composer. */
	refocus: () => void;
}

export async function runChipCopy(
	action: "copy" | "copy-link",
	prompt: Pick<QuickPrompt, "id" | "body">,
	deps: ChipCopyDeps,
): Promise<void> {
	const isLink = action === "copy-link";
	try {
		await deps.writeText(
			isLink ? buildPromptUri(deps.vaultName, prompt.id) : prompt.body,
		);
		deps.notify(
			isLink
				? t("chat.quickPrompts.linkCopied")
				: t("notices.promptTextCopied"),
		);
	} catch (error) {
		deps.logError(
			isLink
				? "[QuickPrompts] copy link failed"
				: "[QuickPrompts] copy failed",
			error,
		);
		deps.notify(
			isLink
				? t("chat.quickPrompts.linkCopyFailed")
				: t("notices.promptTextCopyFailed"),
		);
	} finally {
		deps.refocus();
	}
}
