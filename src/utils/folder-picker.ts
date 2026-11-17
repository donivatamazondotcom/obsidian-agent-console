/**
 * Shared native folder picker backed by Electron's dialog API.
 *
 * Obsidian's desktop host exposes Electron's `remote` module at runtime.
 * Returns the selected absolute directory path, or `null` when the user
 * cancels or the dialog is unavailable (e.g. a non-Electron host) — callers
 * then fall back to manual path entry.
 *
 * Used by both ChangeDirectoryModal (per-chat "New chat in directory…") and
 * the Settings "Default working directory" Browse button, so the picker lives
 * in one place.
 */

import { t } from "../i18n";
export async function pickFolder(options?: {
	title?: string;
	defaultPath?: string;
}): Promise<string | null> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is a runtime-only module provided by Obsidian's host environment
		const { remote } = require("electron") as {
			remote: {
				dialog: {
					showOpenDialog: (opts: {
						properties: string[];
						title: string;
						defaultPath?: string;
					}) => Promise<{
						canceled: boolean;
						filePaths: string[];
					}>;
				};
			};
		};
		const result = await remote.dialog.showOpenDialog({
			properties: ["openDirectory"],
			title: options?.title ?? t("chat.folderPicker.selectDirectory"),
			defaultPath: options?.defaultPath,
		});
		if (!result.canceled && result.filePaths.length > 0) {
			return result.filePaths[0];
		}
	} catch {
		// Electron remote not available — caller falls back to manual entry.
	}
	return null;
}
