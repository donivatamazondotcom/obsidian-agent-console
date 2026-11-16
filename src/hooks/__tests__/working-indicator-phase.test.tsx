/**
 * Working face: the phase hook that owns the indicator's exit and its timer.
 *
 * Seam: the real hook driving a real DOM face (six layers, as WorkingFace
 * renders them), with fake timers. Outcome: the phase the indicator class is
 * derived from, and the captured starting values on the layers (R3).
 *
 * Spec: [[Agent Console Working Face]] § Exit phases (Rules), § Ownership.
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { useWorkingIndicatorPhase, type IndicatorPhase } from "../useWorkingIndicatorPhase";
import type { TurnEnd } from "../../types/session";

const LAYERS = ["chev", "ldash", "rdash", "dotl", "dotr", "happy"] as const;

let lastPhase: IndicatorPhase = "idle";

function Harness({
	isSending,
	lastTurnEnd,
	faceMounted = true,
}: {
	isSending: boolean;
	lastTurnEnd: TurnEnd | null;
	faceMounted?: boolean;
}) {
	const { phase, faceRef } = useWorkingIndicatorPhase({ isSending, lastTurnEnd });
	lastPhase = phase;
	return faceMounted ? (
		<div ref={faceRef} data-testid="face">
			{LAYERS.map((l) => (
				<div
					key={l}
					data-layer={l}
					className={`agent-client-face-layer agent-client-face-${l}`}
					// What the face shows mid-turn: dot eyes up.
					style={{ opacity: l === "dotl" || l === "dotr" ? "1" : "0" }}
				/>
			))}
		</div>
	) : null;
}

const layer = (c: HTMLElement, l: string) =>
	c.querySelector<HTMLElement>(`[data-layer="${l}"]`)!;

beforeEach(() => {
	vi.useFakeTimers();
	lastPhase = "idle";
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	delete (window as { matchMedia?: unknown }).matchMedia;
});

const T0: TurnEnd = { seq: 1, outcome: "endTurn" };

function startTurn(props?: Partial<React.ComponentProps<typeof Harness>>) {
	const r = render(<Harness isSending={false} lastTurnEnd={T0} {...props} />);
	r.rerender(<Harness isSending={true} lastTurnEnd={T0} {...props} />);
	return r;
}

describe("useWorkingIndicatorPhase", () => {
	it("mounts idle, even with a successful last turn end (no happy on restore)", () => {
		render(<Harness isSending={false} lastTurnEnd={T0} />);
		expect(lastPhase).toBe("idle");
	});

	it("mounting mid-turn is working, and a successful end then plays happy", () => {
		const r = render(<Harness isSending={true} lastTurnEnd={T0} />);
		expect(lastPhase).toBe("working");
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		expect(lastPhase).toBe("exit-happy");
	});

	it("a successful end plays happy for 1.14 s, then idle", () => {
		const r = startTurn();
		expect(lastPhase).toBe("working");
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		expect(lastPhase).toBe("exit-happy");
		act(() => vi.advanceTimersByTime(1139));
		expect(lastPhase).toBe("exit-happy");
		act(() => vi.advanceTimersByTime(1));
		expect(lastPhase).toBe("idle");
	});

	it("a cancelled end closes for 0.32 s, then idle", () => {
		const r = startTurn();
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "cancelled" }} />);
		expect(lastPhase).toBe("exit-close");
		act(() => vi.advanceTimersByTime(320));
		expect(lastPhase).toBe("idle");
	});

	it("the exit starts from what the face showed: layer values are captured", () => {
		const r = startTurn();
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		const c = r.container;
		expect(layer(c, "dotl").style.getPropertyValue("--acf-o")).toBe("1");
		expect(layer(c, "chev").style.getPropertyValue("--acf-o")).toBe("0");
		// cleared once the phase returns to idle
		act(() => vi.advanceTimersByTime(1140));
		expect(layer(c, "dotl").style.getPropertyValue("--acf-o")).toBe("");
	});

	it("a new send during an exit returns to working and the timer never fires", () => {
		const r = startTurn();
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		r.rerender(<Harness isSending={true} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		expect(lastPhase).toBe("working");
		expect(layer(r.container, "dotl").style.getPropertyValue("--acf-o")).toBe("");
		act(() => vi.advanceTimersByTime(5000));
		expect(lastPhase).toBe("working");
	});

	it("unmounting during an exit clears the timer", () => {
		const r = startTurn();
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		r.unmount();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("a turn that ends on an inactive tab (face not mounted) goes straight to idle", () => {
		const r = startTurn({ faceMounted: false });
		r.rerender(
			<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} faceMounted={false} />,
		);
		expect(lastPhase).toBe("idle");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("the face remounting during an exit (tab switched away and back) goes to idle", () => {
		const end: TurnEnd = { seq: 2, outcome: "endTurn" };
		const r = startTurn();
		r.rerender(<Harness isSending={false} lastTurnEnd={end} />);
		expect(lastPhase).toBe("exit-happy");
		r.rerender(<Harness isSending={false} lastTurnEnd={end} faceMounted={false} />);
		r.rerender(<Harness isSending={false} lastTurnEnd={end} />);
		expect(lastPhase).toBe("idle");
	});

	it("a lastTurnEnd change with no sending change starts no exit", () => {
		const r = render(<Harness isSending={false} lastTurnEnd={T0} />);
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		expect(lastPhase).toBe("idle");
	});

	it("reduced motion hides straight away", () => {
		(window as { matchMedia?: unknown }).matchMedia = (q: string) => ({
			matches: q.includes("prefers-reduced-motion"),
		});
		const r = startTurn();
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		expect(lastPhase).toBe("idle");
	});

	it("no matchMedia (jsdom, old hosts) is treated as no reduced motion", () => {
		expect((window as { matchMedia?: unknown }).matchMedia).toBeUndefined();
		const r = startTurn();
		r.rerender(<Harness isSending={false} lastTurnEnd={{ seq: 2, outcome: "endTurn" }} />);
		expect(lastPhase).toBe("exit-happy");
	});
});
