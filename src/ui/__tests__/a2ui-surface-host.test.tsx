/**
 * A2uiSurfaceHost — renders a validated buttons-v0 surface with native
 * controls (T01), keyboard-first activation via real <button> elements
 * (T03), resolver-driven enablement + answered state (T04), inert fallback
 * for invalid payloads (T06), and dispatch-failure re-enable (T11).
 *
 * R4 mock budget: obsidian is stubbed (module boundary); activation is an
 * injected callback (the port seam). No sibling a2ui modules are mocked —
 * the real validator/resolvers run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	// platform.ts reads Platform at import time (I134 caveat for ad-hoc mocks).
	Platform: { isMacOS: true },
}));

// The shared MarkdownRenderer is the declared boundary D11 keeps surfaces out
// of (it needs a live Obsidian Component); render the text verbatim instead.
vi.mock("../shared/MarkdownRenderer", async () => {
	const React = await import("react");
	return {
		MarkdownRenderer: (props: { text: string }) =>
			React.createElement("pre", null, props.text),
	};
});

afterEach(cleanup);

import { A2uiSurfaceHost } from "../A2uiSurfaceHost";
import type AgentClientPlugin from "../../plugin";

const ENVELOPE = JSON.stringify({
	version: "v1.0",
	createSurface: {
		surfaceId: "migration-scope-7f3a",
		catalogId: "https://agentconsole.dev/a2ui/catalogs/buttons-v0",
		components: [
			{ id: "root", component: "Row", children: ["minimal", "complete"] },
			{ id: "minimal-label", component: "Text", text: "Minimal migration" },
			{
				id: "minimal",
				component: "Button",
				child: "minimal-label",
				action: {
					event: { name: "choose_scope", context: { scope: "minimal" } },
				},
			},
			{ id: "complete-label", component: "Text", text: "Complete migration" },
			{
				id: "complete",
				component: "Button",
				child: "complete-label",
				action: {
					event: { name: "choose_scope", context: { scope: "complete" } },
				},
			},
		],
	},
});

const PLUGIN = {} as AgentClientPlugin;

function renderHost(
	overrides: Partial<React.ComponentProps<typeof A2uiSurfaceHost>> = {},
) {
	const onActivate = vi.fn(
		overrides.onActivate ?? (async (): Promise<boolean> => true),
	);
	const body = overrides.body ?? ENVELOPE;
	const utils = render(
		<A2uiSurfaceHost
			body={body}
			fenceText={overrides.fenceText ?? "```a2ui\n" + body + "\n```"}
			plugin={PLUGIN}
			answeredComponentId={overrides.answeredComponentId ?? null}
			duplicate={overrides.duplicate ?? false}
			isSending={overrides.isSending ?? false}
			isQueued={overrides.isQueued ?? false}
			isRestoringSession={overrides.isRestoringSession ?? false}
			isStreamingTurn={overrides.isStreamingTurn ?? false}
			onActivate={onActivate}
		/>,
	);
	return { ...utils, onActivate };
}

describe("A2uiSurfaceHost — valid surface (T01)", () => {
	it("renders native buttons with labels from the component tree", () => {
		renderHost();
		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(2);
		expect(buttons[0].tagName).toBe("BUTTON");
		expect(buttons[0].textContent).toBe("Minimal migration");
		expect(buttons[1].textContent).toBe("Complete migration");
	});

	it("enables controls on an idle tab", () => {
		renderHost();
		for (const b of screen.getAllByRole("button")) {
			expect((b as HTMLButtonElement).disabled).toBe(false);
		}
	});

	it("disables controls while the turn is streaming, with a reason (T01/T04a)", () => {
		renderHost({ isStreamingTurn: true });
		for (const b of screen.getAllByRole("button")) {
			expect((b as HTMLButtonElement).disabled).toBe(true);
			expect(b.getAttribute("aria-label")).toBeTruthy();
		}
	});

	it("disables while a message is queued (T04b) — never queues", () => {
		const { onActivate } = renderHost({ isQueued: true });
		const [button] = screen.getAllByRole("button");
		expect((button as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(button);
		expect(onActivate).not.toHaveBeenCalled();
	});
});

describe("A2uiSurfaceHost — activation (T02/T03)", () => {
	it("click activates with the surface and chosen button", async () => {
		const { onActivate } = renderHost();
		fireEvent.click(screen.getAllByRole("button")[1]);
		expect(onActivate).toHaveBeenCalledTimes(1);
		const [surface, button] = onActivate.mock.calls[0];
		expect(surface.surfaceId).toBe("migration-scope-7f3a");
		expect(button.id).toBe("complete");
		expect(button.event.context).toEqual({ scope: "complete" });
	});

	it("keyboard activation rides the native button (T03)", () => {
		// jsdom: native <button> fires click on Enter/Space via the browser;
		// asserting the element is a real BUTTON is the platform contract —
		// no hand-rolled key handlers should exist.
		renderHost();
		const [button] = screen.getAllByRole("button");
		expect(button.tagName).toBe("BUTTON");
		expect(button.getAttribute("role")).toBeNull(); // no role= override
		expect(button.getAttribute("tabindex")).toBeNull(); // native focus order
	});

	it("marks the surface pending during dispatch — no double submission", async () => {
		let resolveSend: (v: boolean) => void = () => {};
		const onActivate = vi.fn(
			() => new Promise<boolean>((r) => (resolveSend = r)),
		);
		renderHost({ onActivate });
		const [button] = screen.getAllByRole("button");
		fireEvent.click(button);
		fireEvent.click(button); // second click while pending
		expect(onActivate).toHaveBeenCalledTimes(1);
		resolveSend(true);
	});

	it("re-enables the surface when dispatch fails (T11)", async () => {
		const onActivate = vi.fn().mockResolvedValue(false);
		renderHost({ onActivate });
		const [button] = screen.getAllByRole("button");
		fireEvent.click(button);
		await screen.findAllByRole("button"); // flush microtasks
		expect((button as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(button);
		expect(onActivate).toHaveBeenCalledTimes(2);
	});
});

describe("A2uiSurfaceHost — answered state (T04/T05)", () => {
	it("disables all buttons and highlights the chosen one", () => {
		renderHost({ answeredComponentId: "complete" });
		const buttons = screen.getAllByRole("button");
		for (const b of buttons)
			expect((b as HTMLButtonElement).disabled).toBe(true);
		expect(buttons[1].className).toContain("chosen");
		expect(buttons[0].className).not.toContain("chosen");
	});
});

describe("A2uiSurfaceHost — inert fallbacks (T06)", () => {
	it("renders invalid payloads as an inert code block with a muted reason", () => {
		const { container } = renderHost({ body: "{broken json" });
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(
			container.querySelector(".agent-client-a2ui-inert-reason"),
		).not.toBeNull();
		// The canonical fence stays visible as a code block.
		expect(container.textContent).toContain("{broken json");
	});

	it("renders a duplicate surfaceId inert (first definition wins)", () => {
		const { container } = renderHost({ duplicate: true });
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(
			container.querySelector(".agent-client-a2ui-inert-reason"),
		).not.toBeNull();
	});

	it("renders out-of-profile components inert — no partial activation", () => {
		const body = JSON.stringify({
			version: "v1.0",
			createSurface: {
				surfaceId: "x-1a2b",
				catalogId: "https://agentconsole.dev/a2ui/catalogs/buttons-v0",
				components: [
					{ id: "root", component: "Column", children: ["ok", "bad"] },
					{ id: "ok-label", component: "Text", text: "Fine" },
					{
						id: "ok",
						component: "Button",
						child: "ok-label",
						action: { event: { name: "go", context: {} } },
					},
					{ id: "bad", component: "Image", url: "https://x.test/a.png" },
				],
			},
		});
		renderHost({ body });
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});
});

describe("A2uiSurfaceHost — layout components", () => {
	it("renders Column/Card/Divider structure with plain-text Text", () => {
		const body = JSON.stringify({
			version: "v1.0",
			createSurface: {
				surfaceId: "layout-1a2b",
				catalogId: "https://agentconsole.dev/a2ui/catalogs/buttons-v0",
				components: [
					{ id: "root", component: "Column", children: ["card", "div", "note"] },
					{ id: "card", component: "Card", children: ["desc", "b"] },
					{ id: "desc", component: "Text", text: "**not markdown**" },
					{ id: "b-label", component: "Text", text: "Pick" },
					{
						id: "b",
						component: "Button",
						child: "b-label",
						action: { event: { name: "pick", context: {} } },
					},
					{ id: "div", component: "Divider" },
					{ id: "note", component: "Text", text: "footer" },
				],
			},
		});
		const { container } = renderHost({ body });
		expect(container.querySelector(".agent-client-a2ui-card")).not.toBeNull();
		expect(container.querySelector("hr")).not.toBeNull();
		// Text renders PLAIN — markdown chars appear literally (D12 #5).
		expect(container.textContent).toContain("**not markdown**");
	});
});
