/**
 * Loaded into the isolated Obsidian's MAIN process with
 * `require("@electron/remote").require(<this file>)`, so the listener below
 * runs synchronously when Obsidian creates the settings window. A listener
 * registered from the renderer is called back over IPC and can lose the race
 * with Obsidian's own show/focus of that window.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Window, DPR and focus.
 */
"use strict";

let LOG = "";

/** Diagnostics: append what the hook does to this file ("" turns it off). */
function setLog(p) {
	LOG = p || "";
}

function log(line) {
	if (!LOG) return;
	try {
		require("fs").appendFileSync(LOG, `${new Date().toISOString().slice(11, 23)} ${line}\n`);
	} catch (e) {
		/* diagnostics only */
	}
}

/**
 * Make a window unable to take focus or clicks: invisible (opacity 0),
 * non-focusable, click-through, and `show`/`focus` replaced on this instance
 * so neither activates the app. The window is destroyed when settings close,
 * so the overrides die with it. Throws if any step fails; marked done only
 * after every step succeeded.
 */
function tame(w) {
	if (!w || w.isDestroyed() || w.__acTamed) return;
	// Overrides first, so a show() during the native calls is already inactive.
	if (!w.__acShowInactive) {
		const showInactive = w.showInactive.bind(w);
		w.__acShowInactive = showInactive;
		w.show = () => {
			log(`show -> showInactive id=${w.id} focusable=${w.isFocusable()}`);
			showInactive();
		};
		w.focus = () => log(`focus ignored id=${w.id}`);
	}
	w.setOpacity(0);
	w.setFocusable(false);
	w.setIgnoreMouseEvents(true);
	w.__acTamed = true;
	log(`tamed id=${w.id}`);
}

let armed = null;

/**
 * Tame the next window the app creates, inside its creation event. Call
 * `disarm()` once the open is over, so a reused window can't leave the
 * listener waiting for an unrelated window.
 */
function armOnce(app) {
	disarm();
	const a = app || require("electron").app;
	const listener = (_e, w) => {
		armed = null;
		log(`created id=${w.id} visible=${w.isVisible()}`);
		try {
			tame(w);
		} catch (e) {
			log(`tame failed id=${w.id}: ${e}`);
		}
	};
	a.once("browser-window-created", listener);
	armed = { app: a, listener };
}

/** Remove the creation listener if it hasn't fired. */
function disarm() {
	if (!armed) return;
	armed.app.removeListener("browser-window-created", armed.listener);
	armed = null;
}

let watching = false;

/**
 * Diagnostics: log every window that gets focus and every time the app
 * becomes active, with window id and title, so a focus steal names its window.
 */
function watchFocus(app) {
	if (watching) return;
	watching = true;
	const a = app || require("electron").app;
	a.on("browser-window-focus", (_e, w) => log(`window focus id=${w.id} title=${JSON.stringify(w.getTitle())}`));
	a.on("did-become-active", () => log("app became active"));
}

module.exports = { armOnce, disarm, setLog, tame, watchFocus };
