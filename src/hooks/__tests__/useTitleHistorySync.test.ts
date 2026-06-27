import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTitleHistorySync } from "../useTitleHistorySync";

/**
 * I112 — the resolved AI title must reach the session-history record.
 *
 * Live-wiring test (per the F03 lesson): asserts the hook actually CALLS
 * updateSessionTitle when the title resolves — not merely that a pure decision
 * function returns the right value. Against the unfixed code there is no hook
 * (the AI title only updated the tab label), so the history pane kept the
 * first-message text.
 */

type Props = Parameters<typeof useTitleHistorySync>[0];

describe("useTitleHistorySync (I112)", () => {
	it("calls updateSessionTitle when the AI title resolves", () => {
		const spy = vi.fn();
		const { rerender } = renderHook(
			(p: Props) => useTitleHistorySync(p),
			{
				initialProps: {
					suggestedTitle: null,
					sessionId: "s1",
					cwd: "/vault",
					updateSessionTitle: spy,
				},
			},
		);
		expect(spy).not.toHaveBeenCalled();

		rerender({
			suggestedTitle: "Fix scroll jitter",
			sessionId: "s1",
			cwd: "/vault",
			updateSessionTitle: spy,
		});
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith("s1", "Fix scroll jitter", "/vault");
	});

	it("does not re-sync the same title (de-dup)", () => {
		const spy = vi.fn();
		const { rerender } = renderHook((p: Props) => useTitleHistorySync(p), {
			initialProps: {
				suggestedTitle: "Title A",
				sessionId: "s1",
				cwd: "/vault",
				updateSessionTitle: spy,
			},
		});
		expect(spy).toHaveBeenCalledTimes(1);
		rerender({
			suggestedTitle: "Title A",
			sessionId: "s1",
			cwd: "/vault",
			updateSessionTitle: spy,
		});
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("no-ops until a sessionId exists, then syncs once it arrives", () => {
		const spy = vi.fn();
		const { rerender } = renderHook((p: Props) => useTitleHistorySync(p), {
			initialProps: {
				suggestedTitle: "Title B",
				sessionId: null,
				cwd: "/vault",
				updateSessionTitle: spy,
			},
		});
		expect(spy).not.toHaveBeenCalled();
		rerender({
			suggestedTitle: "Title B",
			sessionId: "s9",
			cwd: "/vault",
			updateSessionTitle: spy,
		});
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith("s9", "Title B", "/vault");
	});

	it("resets on title clear so a new chat can sync a fresh title", () => {
		const spy = vi.fn();
		const { rerender } = renderHook((p: Props) => useTitleHistorySync(p), {
			initialProps: {
				suggestedTitle: "T1",
				sessionId: "s1",
				cwd: "/vault",
				updateSessionTitle: spy,
			},
		});
		expect(spy).toHaveBeenCalledTimes(1);
		rerender({
			suggestedTitle: null,
			sessionId: "s1",
			cwd: "/vault",
			updateSessionTitle: spy,
		});
		rerender({
			suggestedTitle: "T1",
			sessionId: "s1",
			cwd: "/vault",
			updateSessionTitle: spy,
		});
		expect(spy).toHaveBeenCalledTimes(2);
	});
});
