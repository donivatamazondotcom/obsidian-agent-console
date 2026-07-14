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

/**
 * Obsidian's DOM-creation helpers (`createDiv`, `createEl`, `createFragment`
 * globals plus `HTMLElement.prototype.createDiv`/`createEl`). Minimal shims
 * matching the DomElementInfo subset the plugin uses (cls, text).
 */
type DomInfo = { cls?: string | string[]; text?: string } | string;

function applyDomInfo(el: HTMLElement, o?: DomInfo): void {
	if (typeof o === "string") {
		el.className = o;
		return;
	}
	if (!o) return;
	if (o.cls) {
		el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	}
	if (o.text !== undefined) el.textContent = o.text;
}

type DomCreationGlobals = {
	createEl: (tag: string, o?: DomInfo) => HTMLElement;
	createDiv: (o?: DomInfo) => HTMLDivElement;
	createFragment: (
		callback?: (el: DocumentFragment) => void,
	) => DocumentFragment;
};

const domGlobals = window as unknown as DomCreationGlobals;
if (typeof domGlobals.createEl !== "function") {
	domGlobals.createEl = (tag, o) => {
		const el = window.document.createElement(tag);
		applyDomInfo(el, o);
		return el;
	};
	domGlobals.createDiv = (o) =>
		domGlobals.createEl("div", o) as HTMLDivElement;
	domGlobals.createFragment = (callback) => {
		const fragment = window.document.createDocumentFragment();
		callback?.(fragment);
		return fragment;
	};
}

type ElementCreators = {
	createEl?: (tag: string, o?: DomInfo) => HTMLElement;
	createDiv?: (o?: DomInfo) => HTMLDivElement;
};

const elementProto = HTMLElement.prototype as unknown as ElementCreators;
if (typeof elementProto.createEl !== "function") {
	elementProto.createEl = function (
		this: HTMLElement,
		tag: string,
		o?: DomInfo,
	): HTMLElement {
		const el = domGlobals.createEl(tag, o);
		this.appendChild(el);
		return el;
	};
	elementProto.createDiv = function (
		this: HTMLElement,
		o?: DomInfo,
	): HTMLDivElement {
		const el = domGlobals.createDiv(o);
		this.appendChild(el);
		return el;
	};
}
