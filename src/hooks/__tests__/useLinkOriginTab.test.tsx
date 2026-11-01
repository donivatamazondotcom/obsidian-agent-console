/**
 * Per-tab state for a tab opened by an `obsidian://agent-console` link.
 * Spec: [[Agent Console Quick Prompt URIs]] T12 (no pill crystallization) and
 * T13 (origin banner).
 *
 * Enters at the public hook API ChatPanel uses, with the real `initialPrompt`
 * shape ChatView hands a spawned tab. T12 asserts the user-visible outcome via
 * the shared `computeProvisionalPath` resolver (the same one ChatPanel renders
 * from); the first-send half is covered by useChatActions' "does not
 * auto-default when suppressed" case, which reads the same flag.
 *
 * Red-first: written before `useLinkOriginTab` and `LinkOriginBanner` exist.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import * as React from "react";
import { useLinkOriginTab } from "../useLinkOriginTab";
import { LinkOriginBanner } from "../../ui/LinkOriginBanner";
import { computeProvisionalPath } from "../../utils/provisional-context";

afterEach(cleanup);

const NOTE = "Inbox/Some unrelated note.md";

function provisional(suppressed: boolean): string | null {
	return computeProvisionalPath({
		settingOn: true,
		suppressed,
		messageCount: 0,
		activeNotePath: NOTE,
		committed: [],
	});
}

describe("T12: a URI fire never offers the active-note pill", () => {
	it("a link-opened tab starts with auto-context suppressed → no provisional pill", () => {
		const { result } = renderHook(() =>
			useLinkOriginTab({
				initialPrompt: { text: "x", send: false, suppressAutoContext: true },
				messageCount: 0,
			}),
		);
		expect(result.current.initialAutoContextSuppressed).toBe(true);
		expect(provisional(result.current.initialAutoContextSuppressed)).toBeNull();
	});

	it("an ordinary quick-prompt tab still offers the pill", () => {
		const { result } = renderHook(() =>
			useLinkOriginTab({
				initialPrompt: { text: "x", send: false },
				messageCount: 0,
			}),
		);
		expect(provisional(result.current.initialAutoContextSuppressed)).toBe(NOTE);
	});

	it("a tab with no seed at all still offers the pill", () => {
		const { result } = renderHook(() =>
			useLinkOriginTab({ initialPrompt: undefined, messageCount: 0 }),
		);
		expect(result.current.initialAutoContextSuppressed).toBe(false);
	});
});

describe("T13: the origin banner", () => {
	it("shows when the link set the agent or mode", () => {
		const { result } = renderHook(() =>
			useLinkOriginTab({
				initialPrompt: { text: "x", send: false, linkOrigin: true },
				messageCount: 0,
			}),
		);
		expect(result.current.bannerVisible).toBe(true);
	});

	it("is absent when agent and mode came from the note", () => {
		const { result } = renderHook(() =>
			useLinkOriginTab({
				initialPrompt: { text: "x", send: false, suppressAutoContext: true },
				messageCount: 0,
			}),
		);
		expect(result.current.bannerVisible).toBe(false);
	});

	it("goes away once the user sends (first message lands)", () => {
		const { result, rerender } = renderHook(
			({ count }) =>
				useLinkOriginTab({
					initialPrompt: { text: "x", send: false, linkOrigin: true },
					messageCount: count,
				}),
			{ initialProps: { count: 0 } },
		);
		expect(result.current.bannerVisible).toBe(true);
		rerender({ count: 1 });
		expect(result.current.bannerVisible).toBe(false);
		// And it doesn't come back if messages are later cleared.
		rerender({ count: 0 });
		expect(result.current.bannerVisible).toBe(false);
	});

	it("goes away on dismiss", () => {
		const { result } = renderHook(() =>
			useLinkOriginTab({
				initialPrompt: { text: "x", send: false, linkOrigin: true },
				messageCount: 0,
			}),
		);
		act(() => result.current.dismissBanner());
		expect(result.current.bannerVisible).toBe(false);
	});

	it("renders one line naming agent and mode, with a keyboard-operable dismiss button", () => {
		const onDismiss = vi.fn();
		const { container, getByRole } = render(
			<LinkOriginBanner agentName="Test Kiro" modeName="plan" onDismiss={onDismiss} />,
		);
		expect(container.textContent).toContain(
			"Opened by link · Agent: Test Kiro · Mode: plan",
		);
		const btn = getByRole("button", { name: "Dismiss" });
		expect(btn.tagName).toBe("BUTTON");
		fireEvent.click(btn);
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("omits the mode segment when no mode was set", () => {
		const { container } = render(
			<LinkOriginBanner agentName="Test Claude" onDismiss={() => {}} />,
		);
		expect(container.textContent).toContain("Opened by link · Agent: Test Claude");
		expect(container.textContent).not.toContain("Mode:");
	});
});
