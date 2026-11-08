/**
 * Vertical tab rail – ChatView layout seam ([[Agent Console Vertical Tab
 * Rail]] § Layout, § Hot-path cost).
 *
 * ChatView renders its tab surface through `TabsLayout` and reads the setting
 * through `useTabDisplay`; these tests drive both:
 *   - switching the setting swaps strip ↔ rail without remounting a panel
 *     (a remount would tear down the tab's agent session);
 *   - a settings write that doesn't change `tabDisplay` (per-turn session
 *     saves, rail width commits) doesn't re-render the host.
 */
import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import * as React from "react";
import { TabsLayout, useTabDisplay } from "../TabsLayout";

type Snap = { tabDisplay: "horizontal" | "vertical"; tabRailWidth: number; savedSessions: unknown[] };

function store(init: Snap) {
	let snap = init;
	const ls = new Set<() => void>();
	return {
		subscribe: (l: () => void) => {
			ls.add(l);
			return () => ls.delete(l);
		},
		getSnapshot: () => snap,
		write(u: Partial<Snap>) {
			snap = { ...snap, ...u };
			ls.forEach((l) => l());
		},
	};
}

let mounts = 0;
function Panel() {
	React.useEffect(() => {
		mounts++;
	}, []);
	return <div className="panel">panel</div>;
}

let hostRenders = 0;
function Host({ s }: { s: ReturnType<typeof store> }) {
	hostRenders++;
	const display = useTabDisplay(s);
	return (
		<TabsLayout
			tabDisplay={display}
			strip={<div className="strip" />}
			rail={<div className="rail" />}
		>
			<Panel />
		</TabsLayout>
	);
}

describe("TabsLayout", () => {
	it("switching the setting swaps strip and rail without remounting panels", () => {
		mounts = 0;
		const s = store({ tabDisplay: "horizontal", tabRailWidth: 32, savedSessions: [] });
		const { container } = render(<Host s={s} />);
		expect(container.querySelector(".strip")).not.toBeNull();
		expect(container.querySelector(".rail")).toBeNull();
		act(() => s.write({ tabDisplay: "vertical" }));
		expect(container.querySelector(".strip")).toBeNull();
		expect(container.querySelector(".rail")).not.toBeNull();
		expect(
			container.querySelector(".agent-client-tabs-layout.is-vertical"),
		).not.toBeNull();
		act(() => s.write({ tabDisplay: "horizontal" }));
		expect(container.querySelector(".strip")).not.toBeNull();
		expect(mounts).toBe(1);
	});

	it("puts the rail after the panels and the strip before them", () => {
		const s = store({ tabDisplay: "vertical", tabRailWidth: 32, savedSessions: [] });
		const { container } = render(<Host s={s} />);
		const root = container.querySelector(".agent-client-tabs-layout")!;
		expect(Array.from(root.children).map((c) => c.className)).toEqual([
			"agent-client-tab-panels",
			"rail",
		]);
	});

	it("a settings write that leaves tabDisplay alone doesn't re-render the host", () => {
		const s = store({ tabDisplay: "vertical", tabRailWidth: 32, savedSessions: [] });
		render(<Host s={s} />);
		hostRenders = 0;
		act(() => s.write({ savedSessions: [{ id: "x" }] }));
		act(() => s.write({ tabRailWidth: 150 }));
		expect(hostRenders).toBe(0);
	});
});
