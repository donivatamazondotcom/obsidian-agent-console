/**
 * ZeroTabLanding — the zero-tab launcher, now reusing the real InputArea
 * composer (Slice 3 rework per the § UX review). InputArea + useSuggestions are
 * mocked so these tests pin the LANDING WIRING: send → launch, quick-prompt
 * fire → launch(resolved body), whitespace no-op, and the secondary Open
 * session history. The composer's own behavior is covered by InputArea's tests.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import * as React from "react";

const h = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

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

import { ZeroTabLanding } from "../ZeroTabLanding";
import type { QuickPrompt } from "../../types/quick-prompt";

afterEach(() => {
	cleanup();
	h.props = null;
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
		} as unknown as React.ComponentProps<typeof ZeroTabLanding>["plugin"],
		view: {} as React.ComponentProps<typeof ZeroTabLanding>["view"],
		vaultService: {} as React.ComponentProps<typeof ZeroTabLanding>["vaultService"],
		agentLabel: "Claude Code",
		agentId: "claude-code-acp",
		quickPrompts: [] as QuickPrompt[],
		onLaunch: vi.fn(),
		onOpenHistory: vi.fn(),
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

	it("send launches with the content; whitespace is a no-op", async () => {
		const props = makeProps();
		render(<ZeroTabLanding {...props} />);
		const onSend = h.props!.onSendMessage as (c: string) => Promise<void>;
		await act(async () => {
			await onSend("explain this repo");
		});
		expect(props.onLaunch).toHaveBeenCalledWith("explain this repo");
		await act(async () => {
			await onSend("   ");
		});
		expect(props.onLaunch).toHaveBeenCalledTimes(1);
	});

	it("firing a quick prompt launches the resolved body", () => {
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
		expect(props.onLaunch).toHaveBeenCalledWith("Summarize this note");
	});

	it("wires the secondary Open session history", () => {
		const props = makeProps();
		const { container } = render(<ZeroTabLanding {...props} />);
		const btn = container.querySelector(
			".agent-client-zero-tab-landing-history",
		) as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		btn!.click();
		expect(props.onOpenHistory).toHaveBeenCalledTimes(1);
	});
});
