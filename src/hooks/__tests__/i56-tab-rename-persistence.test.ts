/**
 * Reproducing test for I56: a manual tab rename is overwritten by the
 * first-message / session-title label derivation (e.g. after restart).
 *
 * Per SDLC § Stack-Trace Patch Anti-Pattern: this MUST fail against the
 * unfixed code (red bar), then pass after the fix (green bar).
 *
 * Fix contract: setTabLabel(tabId, label, custom?) — a manual rename
 * (custom=true) sets a `labelIsCustom` flag; a later auto-derive call
 * (custom omitted/false) must NOT overwrite a custom label.
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabManager } from "../useTabManager";

describe("I56 — manual rename survives auto-derive", () => {
	it("auto-derive does NOT overwrite a manually-renamed label", () => {
		const { result } = renderHook(() => useTabManager("auto-sa"));
		const tabId = result.current.activeTab.tabId;

		// User manually renames the tab (custom = true).
		act(() => result.current.setTabLabel(tabId, "Agent defaults config", true));
		expect(result.current.activeTab.label).toBe("Agent defaults config");

		// Later, the first-message / session-title derivation fires
		// (custom omitted -> auto path). It must be a no-op on a custom label.
		act(() =>
			result.current.setTabLabel(
				tabId,
				"See the chat in #obsidian-agent-console…",
			),
		);

		// The manual rename must survive (this is what breaks pre-fix).
		expect(result.current.activeTab.label).toBe("Agent defaults config");
	});

	it("auto-derive still sets the label when the tab was never manually renamed", () => {
		const { result } = renderHook(() => useTabManager("auto-sa"));
		const tabId = result.current.activeTab.tabId;

		act(() => result.current.setTabLabel(tabId, "Derived from first message"));
		expect(result.current.activeTab.label).toBe("Derived from first message");
	});
});
