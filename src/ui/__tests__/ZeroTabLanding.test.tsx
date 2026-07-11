/**
 * ZeroTabLanding — the zero-tab launcher, reusing the real InputArea composer
 * and the real ContextStrip (carry-context). InputArea + useSuggestions are
 * mocked so these tests pin the LANDING WIRING: send → launch (carrying pinned
 * notes), quick-prompt fire → launch(resolved body), whitespace no-op, the
 * launcher `launches` flag threaded from the resolver, and the secondary Open
 * session history. The composer's own behavior is covered by InputArea's tests;
 * the strip's own behavior by ContextStrip's tests. The context hooks
 * (useContextNotes real; useSelectionTracker / useSettings / usePillOpenScope
 * mocked) let us exercise pin → carry without a live vault.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import * as React from "react";

const h = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
const tracker = vi.hoisted(() => ({
	value: {
		activeNotePath: null as string | null,
		activeNoteName: null as string | null,
		selection: null as unknown,
	},
}));

vi.mock("../InputArea", () => ({
	InputArea: (props: Record<string, unknown>) => {
		h.props = props;
		return <div data-testid="input-area" />;
	},
}));

vi.mock("../../hooks/useSuggestions", () => ({
	useSuggestions: () => ({
		mentions: {},
		commands: {},
		quickPrompts: {},
		activePicker: null,
	}),
}));

vi.mock("../../hooks/useSelectionTracker", () => ({
	useSelectionTracker: () => tracker.value,
}));

vi.mock("../../hooks/useSettings", () => ({
	useSettings: () => ({ activeNoteAsDefaultContext: false }),
}));

vi.mock("../use-pill-open-scope", () => ({
	usePillOpenScope: () => undefined,
}));

import { ZeroTabLanding } from "../ZeroTabLanding";
import type { QuickPrompt } from "../../types/quick-prompt";

afterEach(() => {
	cleanup();
	h.props = null;
	tracker.value = {
		activeNotePath: null,
		activeNoteName: null,
		selection: null,
	};
});

function qp(overrides: Partial<QuickPrompt> = {}): QuickPrompt {
	return {
		id: "id",
		label: "Label",
		body: "prompt body",
		path: "Quick Prompts/x.md",
		usesSelection: false,
		...overrides,
	};
}

function makeProps(overrides: Partial<React.ComponentProps<typeof ZeroTabLanding>> = {}) {
	return {
		plugin: {
			quickPromptLibrary: {
				getPrompts: () => [],
				subscribe: () => () => {},
			},
			settings: {},
			app: { workspace: {} },
		} as unknown as React.ComponentProps<typeof ZeroTabLanding>["plugin"],
		view: {} as React.ComponentProps<typeof ZeroTabLanding>["view"],
		vaultService: {} as React.ComponentProps<typeof ZeroTabLanding>["vaultService"],
		agentLabel: "Claude Code",
		agentId: "claude-code-acp",
		quickPrompts: [] as QuickPrompt[],
		onLaunch: vi.fn(),
		onOpenHistory: vi.fn(),
		onNewChatWithAgent: vi.fn(),
		showAgentPicker: true,
		...overrides,
	};
}

describe("ZeroTabLanding — InputArea launcher wiring", () => {
	it("renders the real InputArea with launcher props (images off, default agent)", () => {
		const props = makeProps();
		render(<ZeroTabLanding {...props} />);
		expect(h.props).not.toBeNull();
		expect(h.props!.supportsImages).toBe(false);
		expect(h.props!.agentId).toBe("claude-code-acp");
		expect(h.props!.agentLabel).toBe("Claude Code");
		expect(h.props!.lazyState).toBe("idle");
	});

	it("threads launches from deriveComposerAffordances (landing sendMode:launch)", () => {
		// The landing READS the shared composer resolver; surface:"landing"
		// resolves sendMode:"launch", so InputArea receives launches:true. That
		// is the wiring that makes Enter dispatch a launch instead of
		// dead-queueing on a launcher composer (I169). Pins Seam A: resolver →
		// InputArea prop.
		render(<ZeroTabLanding {...makeProps()} />);
		expect(h.props!.launches).toBe(true);
	});

	it("send launches with the content (empty context); whitespace is a no-op", async () => {
		const props = makeProps();
		render(<ZeroTabLanding {...props} />);
		const onSend = h.props!.onSendMessage as (c: string) => Promise<void>;
		await act(async () => {
			await onSend("explain this repo");
		});
		expect(props.onLaunch).toHaveBeenCalledWith("explain this repo", []);
		await act(async () => {
			await onSend("   ");
		});
		expect(props.onLaunch).toHaveBeenCalledTimes(1);
	});

	it("carries pinned context notes into the launch (context:carry)", async () => {
		tracker.value = {
			activeNotePath: "Notes/API.md",
			activeNoteName: "API",
			selection: null,
		};
		const props = makeProps();
		const { container } = render(<ZeroTabLanding {...props} />);
		// Pin the active note via the real ContextStrip grab button.
		const grab = container.querySelector(
			".context-strip-grab",
		) as HTMLButtonElement;
		expect(grab).not.toBeNull();
		expect(grab.disabled).toBe(false);
		act(() => {
			grab.click();
		});
		// Launch via the composer send — the pinned note travels with it.
		const onSend = h.props!.onSendMessage as (c: string) => Promise<void>;
		await act(async () => {
			await onSend("review the api");
		});
		expect(props.onLaunch).toHaveBeenCalledWith("review the api", [
			{ path: "Notes/API.md", source: "user", seen: false },
		]);
	});

	it("firing a quick prompt launches the resolved body (empty context)", () => {
		const props = makeProps({ quickPrompts: [qp({ id: "brief" })] });
		render(<ZeroTabLanding {...props} />);
		expect(
			(h.props!.quickPromptPrompts as QuickPrompt[]).length,
		).toBe(1);
		const onRun = h.props!.onRunQuickPrompt as (
			p: QuickPrompt,
			g: unknown,
		) => void;
		act(() => {
			onRun(qp({ body: "Summarize this note" }), {
				openElsewhere: false,
				foreground: false,
				insert: false,
			});
		});
		// No {{selection}} → resolves verbatim.
		expect(props.onLaunch).toHaveBeenCalledWith("Summarize this note", []);
	});

	it("wires New chat with an agent and Open session history", () => {
		const props = makeProps();
		const { container } = render(<ZeroTabLanding {...props} />);
		const actions = container.querySelectorAll(
			".agent-client-zero-tab-landing-action",
		);
		expect(actions.length).toBe(2);
		(actions[0] as HTMLButtonElement).click();
		expect(props.onNewChatWithAgent).toHaveBeenCalledTimes(1);
		(actions[1] as HTMLButtonElement).click();
		expect(props.onOpenHistory).toHaveBeenCalledTimes(1);
	});

	it("hides New chat with an agent when the picker has no real choice", () => {
		const props = makeProps({ showAgentPicker: false });
		const { container } = render(<ZeroTabLanding {...props} />);
		const actions = container.querySelectorAll(
			".agent-client-zero-tab-landing-action",
		);
		expect(actions.length).toBe(1); // only Open session history
		(actions[0] as HTMLButtonElement).click();
		expect(props.onOpenHistory).toHaveBeenCalledTimes(1);
		expect(props.onNewChatWithAgent).not.toHaveBeenCalled();
	});
});
