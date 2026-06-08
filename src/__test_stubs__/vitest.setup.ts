/**
 * Vitest global setup — shims the Obsidian-provided browser globals that
 * jsdom does not supply.
 *
 * Obsidian augments the runtime environment with:
 *  - `activeDocument` / `activeWindow`: the document/window of the currently
 *    active (possibly popped-out) window. In the single-window jsdom test
 *    environment they alias the test document/window.
 *  - `HTMLElement.prototype.setCssProps`: an inline-style writer jsdom lacks.
 *    Shimmed to `setProperty` so `el.style.<prop>` reads stay consistent with
 *    the write, matching Obsidian's behavior.
 *
 * Production resolves all of these via Obsidian itself; only tests need them.
 * Uses `window` (not `globalThis`) per obsidianmd/no-global-this — under the
 * jsdom environment `window` is the global object.
 */

type ObsidianTestGlobals = {
	activeDocument: Document;
	activeWindow: Window;
};

const testGlobals = window as unknown as ObsidianTestGlobals;
testGlobals.activeDocument = window.document;
testGlobals.activeWindow = window;

if (
	typeof HTMLElement !== "undefined" &&
	typeof HTMLElement.prototype.setCssProps !== "function"
) {
	HTMLElement.prototype.setCssProps = function (
		this: HTMLElement,
		props: Record<string, string>,
	): void {
		for (const key of Object.keys(props)) {
			this.style.setProperty(key, props[key]);
		}
	};
}
