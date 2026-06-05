/**
 * Vitest global setup — shims the Obsidian-provided browser globals that
 * jsdom does not supply.
 *
 * Obsidian augments the runtime environment with:
 *  - `activeDocument` / `activeWindow`: the document/window of the currently
 *    active (possibly popped-out) window. In the single-window jsdom test
 *    environment they alias the test document/window.
 *  - `HTMLElement.prototype.setCssProps`: the sanctioned inline-style writer
 *    (production code uses it instead of `el.style.x =` per
 *    `obsidianmd/no-static-styles-assignment`). jsdom has no such method,
 *    so we shim it to `setProperty` — which keeps `el.style.<prop>` reads
 *    consistent with the write, matching Obsidian's behavior.
 *
 * Production resolves all of these via Obsidian itself; only tests need them.
 */

const globals = globalThis as unknown as {
	activeDocument: Document;
	activeWindow: Window & typeof globalThis;
};

globals.activeDocument = globalThis.document;
globals.activeWindow = globalThis.window;

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
