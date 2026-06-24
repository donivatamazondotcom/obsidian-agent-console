/**
 * T15 — the queued (locked) input state must have a DISTINCT visual treatment,
 * separate from the connecting and streaming disabled states (#82 spec §
 * "Disabled-input states must be visually distinct"). Structural guard: assert
 * the dedicated selectors exist in the shipped stylesheet so the distinct
 * treatment can't be silently dropped. Color-vision note: the rule must not
 * rely on red/green — checked by asserting it uses the accent variable.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../../styles.css"), "utf8");

describe("queued input visual distinctness (T15)", () => {
	it("defines a dedicated .agent-client-queued box treatment", () => {
		expect(css).toContain(".agent-client-chat-input-box.agent-client-queued");
	});

	it("defines the queued banner + Edit/Cancel controls", () => {
		expect(css).toContain(".agent-client-queued-banner");
		expect(css).toContain(".agent-client-queued-edit");
		expect(css).toContain(".agent-client-queued-cancel");
	});

	it("uses the accent hue (not red/green) for the queued state", () => {
		// Pull the .agent-client-queued box rule body and assert it leans on
		// the interactive-accent variable rather than a hard-coded red/green.
		const idx = css.indexOf(
			".agent-client-chat-input-box.agent-client-queued",
		);
		const block = css.slice(idx, idx + 240);
		expect(block).toContain("var(--interactive-accent)");
		expect(block).not.toMatch(/red|green|#0f0|#f00/i);
	});

	it("keeps a visible focus outline on the queued controls (keyboard a11y)", () => {
		expect(css).toContain(".agent-client-queued-edit:focus-visible");
	});
});
