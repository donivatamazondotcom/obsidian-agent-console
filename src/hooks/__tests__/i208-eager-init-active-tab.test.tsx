/**
 * I208 — eager initialize must spawn an agent only for the tab that may hold
 * one, not for every mounted tab.
 *
 * Models ChatView's real render structure: EVERY tab's panel stays mounted
 * and inactive ones are hidden (see draft-persistence-tab-switch.test.tsx).
 * Each panel owns its own AcpClient, faked at the acp/ port (R4). The panel
 * runs the same resolver + hook ChatPanel uses, so the outcome asserted is
 * the one that matters: how many agent processes initialize() spawns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useEagerInitialize } from "../useEagerInitialize";
import { decideProcessHold } from "../../resolvers/process-hold";
import type { TabOrigin } from "../../types/tab";

afterEach(cleanup);

/** Fake AcpClient: initialize() "spawns" a process and flips initialized. */
function makeFakeClient() {
	let initialized = false;
	return {
		isInitialized: () => initialized,
		initialize: vi.fn(async () => {
			initialized = true;
		}),
	};
}
type FakeClient = ReturnType<typeof makeFakeClient>;

interface TabSpec {
	tabId: string;
	origin: TabOrigin;
}

function PanelLike({
	client,
	isActive,
	origin,
}: {
	client: FakeClient;
	isActive: boolean;
	origin: TabOrigin;
}) {
	useEagerInitialize({
		decision: decideProcessHold({
			isActive,
			origin,
			hasForkSource: false,
			liveSession: false,
			idleMs: 0,
			busy: [],
		}),
		isInitialized: () => client.isInitialized(),
		initialize: () => client.initialize(),
	});
	return null;
}

function TabsLike({
	tabs,
	activeTabId,
	clients,
}: {
	tabs: TabSpec[];
	activeTabId: string;
	clients: Map<string, FakeClient>;
}) {
	return (
		<div>
			{tabs.map((t) => (
				<div
					key={t.tabId}
					style={{ display: t.tabId === activeTabId ? "flex" : "none" }}
				>
					<PanelLike
						client={clients.get(t.tabId)!}
						isActive={t.tabId === activeTabId}
						origin={t.origin}
					/>
				</div>
			))}
		</div>
	);
}

function totalInitCalls(clients: Map<string, FakeClient>): number {
	let n = 0;
	for (const c of clients.values()) n += c.initialize.mock.calls.length;
	return n;
}

const RESTORED: TabSpec[] = ["A", "B", "C", "D", "E"].map((tabId) => ({
	tabId,
	origin: "restored" as const,
}));

function makeClients(tabs: TabSpec[]) {
	return new Map(tabs.map((t) => [t.tabId, makeFakeClient()]));
}

describe("I208 eager initialize with restored tabs", () => {
	it("5 restored tabs, 1 active → initialize is called once (the active tab)", async () => {
		const clients = makeClients(RESTORED);
		await act(async () => {
			render(<TabsLike tabs={RESTORED} activeTabId="C" clients={clients} />);
		});
		expect(totalInitCalls(clients)).toBe(1);
		expect(clients.get("C")!.initialize).toHaveBeenCalledTimes(1);
	});

	it("activating a second tab initializes it (2 total); switching back does not re-init", async () => {
		const clients = makeClients(RESTORED);
		let rerender!: (ui: React.ReactElement) => void;
		await act(async () => {
			({ rerender } = render(
				<TabsLike tabs={RESTORED} activeTabId="A" clients={clients} />,
			));
		});
		await act(async () => {
			rerender(<TabsLike tabs={RESTORED} activeTabId="B" clients={clients} />);
		});
		expect(totalInitCalls(clients)).toBe(2);
		expect(clients.get("B")!.initialize).toHaveBeenCalledTimes(1);

		await act(async () => {
			rerender(<TabsLike tabs={RESTORED} activeTabId="A" clients={clients} />);
		});
		expect(totalInitCalls(clients)).toBe(2);
	});

	it("a fresh tab opened in the background still initializes (eager acquisition needs capabilities)", async () => {
		const tabs: TabSpec[] = [...RESTORED, { tabId: "F", origin: "fresh" }];
		const clients = makeClients(tabs);
		await act(async () => {
			render(<TabsLike tabs={tabs} activeTabId="A" clients={clients} />);
		});
		expect(totalInitCalls(clients)).toBe(2);
		expect(clients.get("F")!.initialize).toHaveBeenCalledTimes(1);
	});

	it("an init failure is non-fatal and is not retried by re-activation", async () => {
		const clients = makeClients(RESTORED);
		const a = clients.get("A")!;
		a.initialize.mockRejectedValueOnce(new Error("spawn failed"));
		const onError = vi.fn();
		function Single({ active }: { active: boolean }) {
			useEagerInitialize({
				decision: decideProcessHold({
					isActive: active,
					origin: "restored",
					hasForkSource: false,
					liveSession: false,
					idleMs: 0,
					busy: [],
				}),
				isInitialized: () => a.isInitialized(),
				initialize: () => a.initialize(),
				onError,
			});
			return null;
		}
		let rerender!: (ui: React.ReactElement) => void;
		await act(async () => {
			({ rerender } = render(<Single active={true} />));
		});
		expect(onError).toHaveBeenCalledTimes(1);
		await act(async () => {
			rerender(<Single active={false} />);
		});
		await act(async () => {
			rerender(<Single active={true} />);
		});
		// The lazy path retries on first keystroke; the eager path fires once.
		expect(a.initialize).toHaveBeenCalledTimes(1);
	});
});
