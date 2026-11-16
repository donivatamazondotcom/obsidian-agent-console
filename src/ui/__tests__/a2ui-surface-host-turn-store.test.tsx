/**
 * I376: A2uiSurfaceHost reads tab turn state from the panel's turn store.
 *
 * - The live host (unanswered, latest, not streaming) reacts to every turn
 *   field when the store changes after the first render.
 * - Hosts with a surface-scoped refusal (answered, superseded, streaming,
 *   duplicate, invalid) never subscribe, so a turn edge doesn't re-render them.
 * - A mounted host that flips between duplicate and valid keeps its hook
 *   order (both store reads run before the inert return).
 * - Outside a provider the default store refuses every click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { Profiler } from "react";

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMacOS: true },
}));

vi.mock("../shared/MarkdownRenderer", async () => {
	const React = await import("react");
	return {
		MarkdownRenderer: (props: { text: string }) =>
			React.createElement("pre", null, props.text),
	};
});

import { setTooltip } from "obsidian";
import { A2uiSurfaceHost } from "../A2uiSurfaceHost";
import { A2uiTurnStoreContext } from "../a2ui-turn-context";
import {
	createA2uiTurnStore,
	type A2uiTurnState,
	type A2uiTurnStore,
} from "../../services/a2ui/turn-store";
import { t, type TranslationKey } from "../../i18n";
import type AgentClientPlugin from "../../plugin";

afterEach(cleanup);
beforeEach(() => vi.mocked(setTooltip).mockClear());

const PLUGIN = {} as AgentClientPlugin;

function envelope(surfaceId: string): string {
	return JSON.stringify({
		version: "v1.0",
		createSurface: {
			surfaceId,
			catalogId: "https://agentconsole.dev/a2ui/catalogs/buttons-v0",
			components: [
				{ id: "root", component: "Row", children: ["b"] },
				{ id: "l", component: "Text", text: "Go" },
				{
					id: "b",
					component: "Button",
					child: "l",
					action: { event: { name: "go", context: {} } },
				},
			],
		},
	});
}

const IDLE: A2uiTurnState = {
	isSending: false,
	isQueued: false,
	isRestoringSession: false,
	sessionState: "ready",
	heldSurfaceId: null,
};

interface HostSpec {
	surfaceId: string;
	body?: string;
	answered?: boolean;
	superseded?: boolean;
	streaming?: boolean;
	duplicate?: boolean;
}

function Host({ spec }: { spec: HostSpec }): React.ReactElement {
	const body = spec.body ?? envelope(spec.surfaceId);
	return (
		<A2uiSurfaceHost
			body={body}
			fenceText={"```a2ui\n" + body + "\n```"}
			plugin={PLUGIN}
			answeredComponentId={spec.answered ? "b" : null}
			isFirstDefinition={() => !spec.duplicate}
			isLatestDefinition={() => !spec.superseded}
			isStreamingTurn={spec.streaming ?? false}
			onActivate={vi.fn().mockResolvedValue("sent")}
		/>
	);
}

/** Render hosts under one store, counting each host's commits. */
function renderHosts(store: A2uiTurnStore, specs: HostSpec[]) {
	const commits = new Map<string, number>();
	const tree = (list: HostSpec[]) => (
		<A2uiTurnStoreContext.Provider value={store}>
			{list.map((spec) => (
				<Profiler
					key={spec.surfaceId}
					id={spec.surfaceId}
					onRender={(id) => commits.set(id, (commits.get(id) ?? 0) + 1)}
				>
					<div data-host={spec.surfaceId}>
						<Host spec={spec} />
					</div>
				</Profiler>
			))}
		</A2uiTurnStoreContext.Provider>
	);
	const utils = render(tree(specs));
	return { ...utils, commits, rerenderSpecs: (list: HostSpec[]) => utils.rerender(tree(list)) };
}

function buttonOf(container: HTMLElement, surfaceId: string): HTMLButtonElement {
	const b = container.querySelector(`[data-host="${surfaceId}"] button`);
	if (b === null) throw new Error(`no button for ${surfaceId}`);
	return b as HTMLButtonElement;
}

/** The reason text most recently attached to this button (null = cleared). */
function lastTooltip(button: HTMLElement): string | null {
	const calls = vi.mocked(setTooltip).mock.calls.filter((c) => c[0] === button);
	if (calls.length === 0) return null;
	const text = calls[calls.length - 1][1] as string;
	return text === "" ? null : text;
}

describe("A2uiSurfaceHost × turn store — the live host reacts to every turn field (I376)", () => {
	const cases: Array<{
		name: string;
		patch: Partial<A2uiTurnState>;
		disabled: boolean;
		reason: TranslationKey | null;
	}> = [
		{ name: "sending", patch: { isSending: true }, disabled: true, reason: "chat.a2ui.disabledSending" },
		{ name: "queued", patch: { isQueued: true }, disabled: true, reason: "chat.a2ui.disabledQueued" },
		{ name: "restoring", patch: { isRestoringSession: true }, disabled: true, reason: "chat.a2ui.disabledRestoring" },
		{ name: "busy", patch: { sessionState: "busy" }, disabled: true, reason: "chat.a2ui.disabledSending" },
		{ name: "permission", patch: { sessionState: "permission" }, disabled: true, reason: "chat.a2ui.disabledPermission" },
		{ name: "released", patch: { sessionState: "released" }, disabled: false, reason: "chat.a2ui.hintReconnect" },
	];

	it.each(cases)("$name, changed after the first render", ({ patch, disabled, reason }) => {
		const store = createA2uiTurnStore(IDLE);
		const { container } = renderHosts(store, [{ surfaceId: "live-1" }]);
		expect(buttonOf(container, "live-1").disabled).toBe(false);

		act(() => store.publish({ ...IDLE, ...patch }));
		const button = buttonOf(container, "live-1");
		expect(button.disabled).toBe(disabled);
		const tip = lastTooltip(button);
		expect(tip).not.toBeNull();
		expect(tip).toContain(t(reason as TranslationKey));

		// Back to idle: enabled, and the reason is gone from the accessible
		// name (the clear path removes the tooltip without a setTooltip call).
		act(() => store.publish(IDLE));
		const after = buttonOf(container, "live-1");
		expect(after.disabled).toBe(false);
		expect(after.getAttribute("aria-label") ?? "").not.toContain(t(reason as TranslationKey));
	});

	it("held for reconnect shows pending, then re-enables when the slot is released", () => {
		const store = createA2uiTurnStore(IDLE);
		const { container } = renderHosts(store, [{ surfaceId: "live-1" }]);

		act(() => store.publish({ ...IDLE, sessionState: "connecting", heldSurfaceId: "live-1" }));
		let button = buttonOf(container, "live-1");
		expect(button.disabled).toBe(true);
		expect(lastTooltip(button)).toContain(t("chat.a2ui.pendingReconnect"));

		// Failed reconnect: the slot is released, the session errored.
		act(() => store.publish({ ...IDLE, sessionState: "error", heldSurfaceId: null }));
		button = buttonOf(container, "live-1");
		expect(button.disabled).toBe(false);
		fireEvent.click(button);
	});
});

describe("A2uiSurfaceHost × turn store — refused hosts don't re-render on turn edges (I376)", () => {
	it("answered, superseded, streaming, duplicate and invalid hosts stay put; only the live host re-renders", () => {
		const store = createA2uiTurnStore(IDLE);
		const { commits } = renderHosts(store, [
			{ surfaceId: "answered-1", answered: true },
			{ surfaceId: "superseded-1", superseded: true },
			{ surfaceId: "streaming-1", streaming: true },
			{ surfaceId: "dup-1", duplicate: true },
			{ surfaceId: "invalid-1", body: "{not json" },
			{ surfaceId: "live-1" },
		]);
		const before = new Map(commits);
		const steps: A2uiTurnState[] = [
			{ ...IDLE, isSending: true },
			{ ...IDLE },
			{ ...IDLE, isQueued: true },
			// A held id that matches none of the refused hosts.
			{ ...IDLE, isQueued: true, heldSurfaceId: "live-1" },
			{ ...IDLE, sessionState: "released" },
			{ ...IDLE, isRestoringSession: true },
			{ ...IDLE },
		];
		for (const step of steps) act(() => store.publish(step));
		const rerendered = Array.from(commits.entries())
			.filter(([id, n]) => n > (before.get(id) ?? 0))
			.map(([id]) => id);
		expect(rerendered).toEqual(["live-1"]);
	});

	it("a duplicate of the held surface does not re-render when the held id is set or cleared", () => {
		const store = createA2uiTurnStore(IDLE);
		const { commits } = renderHosts(store, [{ surfaceId: "pick-1", duplicate: true }]);
		const before = commits.get("pick-1");
		act(() => store.publish({ ...IDLE, heldSurfaceId: "pick-1" }));
		act(() => store.publish(IDLE));
		expect(commits.get("pick-1")).toBe(before);
	});
});

describe("A2uiSurfaceHost × turn store — hook order (I376)", () => {
	it("a mounted host flips between duplicate and valid without throwing", () => {
		const store = createA2uiTurnStore(IDLE);
		const { container, rerenderSpecs } = renderHosts(store, [{ surfaceId: "pick-1" }]);
		expect(container.querySelector(".agent-client-a2ui-surface")).not.toBeNull();

		rerenderSpecs([{ surfaceId: "pick-1", duplicate: true }]);
		expect(container.querySelector(".agent-client-a2ui-surface")).toBeNull();
		expect(container.querySelector(".agent-client-a2ui-inert")).not.toBeNull();

		rerenderSpecs([{ surfaceId: "pick-1" }]);
		expect(container.querySelector(".agent-client-a2ui-surface")).not.toBeNull();
		act(() => store.publish({ ...IDLE, isSending: true }));
		expect(buttonOf(container, "pick-1").disabled).toBe(true);
	});
});

describe("A2uiSurfaceHost × turn store — no provider (I376)", () => {
	it("refuses every click outside a provider (fail-closed default)", () => {
		const body = envelope("orphan-1");
		const onActivate = vi.fn();
		const { container } = render(
			<A2uiSurfaceHost
				body={body}
				fenceText={"```a2ui\n" + body + "\n```"}
				plugin={PLUGIN}
				answeredComponentId={null}
				isStreamingTurn={false}
				onActivate={onActivate}
			/>,
		);
		const button = container.querySelector("button") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(onActivate).not.toHaveBeenCalled();
	});
});
