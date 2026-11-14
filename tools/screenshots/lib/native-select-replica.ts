/**
 * A DOM replica of an open native `<select>` list, for settings shots.
 *
 * The OS draws a native `<select>` popup in its own window, outside the
 * page, so a page capture never shows it, and opening it for real needs the
 * real screen. The isolated driver builds this replica in the settings page
 * instead: one row per option, in order, with the selected option checked
 * and drawn over the select, as the macOS popup does. Font and text color
 * come from the select's computed style, the rest from the theme's menu
 * variables, so the list follows the theme.
 *
 * Rows hold text only (the check mark is a `::before`), so the settings
 * crop (settings-crop.ts) keeps each row whole. Crop with the setting's
 * group and `#ac-native-select-replica`.
 *
 * The expression runs where the settings DOM lives (`activeDocument` /
 * `activeWindow`, see Cdp.evaluateInSettings). It returns "ok", or why it
 * couldn't build the replica.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Capture modes.
 * Tests: tools/screenshots/lib/__tests__/native-select-replica.test.ts.
 */

/** Element id of the replica. */
export const NATIVE_SELECT_REPLICA_ID = "ac-native-select-replica";

/** Gap, in CSS px, the replica keeps from the window edges. */
const EDGE = 4;
/** Menu padding, border and row inset, in CSS px. */
const PAD = 5;
const BORDER = 1;
const ROW_INSET = 10;

export function nativeSelectReplicaExpression(selector: string): string {
	const id = JSON.stringify(NATIVE_SELECT_REPLICA_ID);
	const styleId = JSON.stringify(`${NATIVE_SELECT_REPLICA_ID}-style`);
	return `(() => {
		/*__acNativeSelectReplica*/
		const want = ${JSON.stringify(selector)};
		const sel = activeDocument.querySelector(want);
		if (!sel) return "no <select> matches " + want;
		if (sel.tagName !== "SELECT") return want + " is not a <select>";
		activeDocument.getElementById(${id})?.remove();
		activeDocument.getElementById(${styleId})?.remove();
		const cs = activeWindow.getComputedStyle(sel);
		const fontSize = parseFloat(cs.fontSize) || 13;
		const rowH = Math.round(fontSize * 1.75);
		const check = Math.round(fontSize * 1.4);
		const textLeft = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
		const style = activeDocument.createElement("style");
		style.id = ${styleId};
		style.textContent = "#" + ${id} + " .row.is-selected::before { content: \\"\\u2713\\"; position: absolute; left: ${ROW_INSET / 2}px; }";
		activeDocument.head.appendChild(style);
		const menu = activeDocument.createElement("div");
		menu.id = ${id};
		menu.setAttribute("aria-hidden", "true");
		Object.assign(menu.style, {
			position: "fixed", zIndex: "2147483647", boxSizing: "border-box",
			padding: "${PAD}px", borderStyle: "solid", borderWidth: "${BORDER}px",
			borderColor: "var(--background-modifier-border-hover)", borderRadius: "10px",
			background: "var(--background-secondary)", boxShadow: "var(--shadow-l)",
			fontFamily: cs.fontFamily, fontSize: cs.fontSize, color: cs.color,
			minWidth: sel.getBoundingClientRect().width + "px", whiteSpace: "nowrap",
		});
		const opts = Array.from(sel.options);
		opts.forEach((o, i) => {
			const row = activeDocument.createElement("div");
			row.className = i === sel.selectedIndex ? "row is-selected" : "row";
			row.textContent = o.textContent || "";
			Object.assign(row.style, {
				position: "relative", boxSizing: "border-box", height: rowH + "px", lineHeight: rowH + "px",
				paddingLeft: (${ROW_INSET / 2} + check) + "px", paddingRight: "${ROW_INSET * 2}px", borderRadius: "5px",
			});
			if (i === sel.selectedIndex) Object.assign(row.style, { background: "var(--interactive-accent)", color: "var(--text-on-accent)" });
			menu.appendChild(row);
		});
		activeDocument.body.appendChild(menu);
		// The selected option sits over the select, its text where the
		// select's own text starts; the list never leaves the window.
		const r = sel.getBoundingClientRect();
		const idx = Math.max(0, sel.selectedIndex);
		const height = 2 * (${PAD} + ${BORDER}) + opts.length * rowH;
		let top = r.y + r.height / 2 - (${BORDER} + ${PAD} + idx * rowH + rowH / 2);
		top = Math.max(${EDGE}, Math.min(top, activeWindow.innerHeight - ${EDGE} - height));
		const width = menu.getBoundingClientRect().width;
		const left = Math.max(${EDGE}, Math.min(r.x + textLeft - (${BORDER} + ${PAD} + ${ROW_INSET / 2} + check), activeWindow.innerWidth - ${EDGE} - width));
		menu.style.top = top + "px";
		menu.style.left = left + "px";
		return "ok";
	})()`;
}
