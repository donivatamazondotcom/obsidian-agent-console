/**
 * Unit tests for `LossyFallbackNotice` — Slice 6 of [[ACP Tab Persistence Across Restarts]].
 *
 * Pins Decision #11 (2026-05-24): a single one-time inline notice rendered above the
 * agent's first response after `session/load` failure triggers client-side replay.
 * Non-dismissible, persisted in message history, callout-style block.
 *
 * Tests U61–U68 from the spec § Unit Tests → `LossyFallbackNotice`. Each `it` block
 * names a single behavior and cites the Decision # / Txx anchor it covers.
 *
 * Conventions inherited from `use-auto-scroll-pin.test.ts`:
 *   - One `describe` per behavioral surface
 *   - `@testing-library/react` `render`
 *   - No real timers, no mocks (the component is purely presentational)
 *
 * Source of truth for the copy: `LOSSY_FALLBACK_NOTICE_COPY` exported from the
 * component module. Tests import it instead of duplicating the literal — the
 * import IS the verbatim-copy guarantee that U63 demands.
 */

import { describe, expect, it } from "vitest";
import * as React from "react";
import { render } from "@testing-library/react";

import {
	LossyFallbackNotice,
	LOSSY_FALLBACK_NOTICE_COPY,
} from "../LossyFallbackNotice";

describe("LossyFallbackNotice — Decision #11", () => {
	// -----------------------------------------------------------------
	// U61: Renders when isFallbackRecovery=true
	// -----------------------------------------------------------------
	it("U61 — renders when isFallbackRecovery is true", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery={true} />,
		);
		expect(container.firstChild).not.toBeNull();
	});

	// -----------------------------------------------------------------
	// U62: Does NOT render when isFallbackRecovery=false
	// -----------------------------------------------------------------
	it("U62 — does NOT render when isFallbackRecovery is false", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery={false} />,
		);
		expect(container.firstChild).toBeNull();
	});

	// -----------------------------------------------------------------
	// U63: Shows the spec's exact copy verbatim (test against a constant)
	// -----------------------------------------------------------------
	it("U63 — shows the spec's exact copy verbatim", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery={true} />,
		);
		// Normalize whitespace to handle any incidental wrapping in JSX.
		const rendered = (container.textContent ?? "")
			.replace(/\s+/g, " ")
			.trim();
		const expected = LOSSY_FALLBACK_NOTICE_COPY.replace(
			/\s+/g,
			" ",
		).trim();
		expect(rendered).toBe(expected);
	});

	// -----------------------------------------------------------------
	// U64: Renders as a callout-style block with info icon and bordered styling
	// -----------------------------------------------------------------
	it("U64 — renders as a callout-style block with info icon and bordered styling", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery={true} />,
		);
		const root = container.firstElementChild as HTMLElement | null;
		expect(root).not.toBeNull();
		// Bordered styling is keyed on this className; CSS in styles.css
		// translates it to the bordered callout look.
		expect(root?.classList.contains("agent-client-fallback-notice")).toBe(
			true,
		);
		// Info icon: the literal `ℹ️` sigil from the spec's copy serves as
		// the info-icon prefix. Verifying the sigil is present in the rendered
		// text covers the "info icon prefixed" requirement without committing
		// to a separate Lucide-icon child node.
		expect(root?.textContent ?? "").toContain("ℹ️");
	});

	// -----------------------------------------------------------------
	// U65: Has NO close button (non-dismissible per #11)
	// -----------------------------------------------------------------
	it("U65 — has no close button (non-dismissible)", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery={true} />,
		);
		expect(container.querySelector("button")).toBeNull();
	});

	// -----------------------------------------------------------------
	// U66: Renders above its sibling agent-response component when both
	// are present
	// -----------------------------------------------------------------
	it("U66 — renders above its sibling agent-response component when both are present", () => {
		const { container } = render(
			<>
				<LossyFallbackNotice isFallbackRecovery={true} />
				<div data-testid="agent-response">First agent response</div>
			</>,
		);
		// The notice must appear before the sibling in DOM order so that
		// users see the recovery context above the agent's response.
		const children = Array.from(container.children);
		expect(children).toHaveLength(2);
		expect(
			(children[0] as HTMLElement).classList.contains(
				"agent-client-fallback-notice",
			),
		).toBe(true);
		expect((children[1] as HTMLElement).dataset.testid).toBe(
			"agent-response",
		);
	});

	// -----------------------------------------------------------------
	// U67: Notice has stable identity (data-message-type="fallback-notice")
	// -----------------------------------------------------------------
	it("U67 — has a stable identity attribute (data-message-type='fallback-notice')", () => {
		const { container } = render(
			<LossyFallbackNotice isFallbackRecovery={true} />,
		);
		const root = container.firstElementChild as HTMLElement | null;
		expect(root?.getAttribute("data-message-type")).toBe("fallback-notice");
	});

	// -----------------------------------------------------------------
	// U68: Re-renders identically when message history is reloaded after
	// restart — the component is a pure function of its props, so two
	// renders with identical props must produce identical DOM.
	// -----------------------------------------------------------------
	it("U68 — re-renders identically when message history is reloaded after restart", () => {
		const first = render(
			<LossyFallbackNotice isFallbackRecovery={true} />,
		);
		const firstHtml = first.container.innerHTML;
		first.unmount();

		const second = render(
			<LossyFallbackNotice isFallbackRecovery={true} />,
		);
		const secondHtml = second.container.innerHTML;
		second.unmount();

		expect(secondHtml).toBe(firstHtml);
	});
});
