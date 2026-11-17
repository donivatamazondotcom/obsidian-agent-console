/**
 * The disk path behind a web `File` from a drop, a paste of copied files, or
 * the attach button's file picker.
 *
 * Electron 32 removed `File.path`; `webUtils.getPathForFile` is its
 * replacement. It returns "" for a `File` built in JS that isn't backed by a
 * file on disk (e.g. a clipboard screenshot). This is the one place the
 * composer touches the Electron host, so tests mock this module instead of
 * Electron itself.
 */
export function getFilePathForFile(file: File): string {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is a runtime-only module provided by Obsidian's host environment
	const { webUtils } = require("electron") as {
		webUtils: { getPathForFile: (file: File) => string };
	};
	return webUtils.getPathForFile(file);
}
