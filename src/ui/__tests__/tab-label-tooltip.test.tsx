/**
 * Tab label hover tooltip — spec [[ACP Tabbed Sessions UX]] § TS-I05.
 *
 * The tab label is CSS-truncated (`text-overflow: ellipsis; max-width: 160px`),
 * so a long note title shows as "Long note titl…" with no way to read the full
 * title. Obsidian's native leaf tabs reveal the full title on hover; this
 * in-panel tab bar (built to follow native tab conventions) must do the same.
 *
 * Fix: each tab calls Obsidian's `setTooltip(el, fullLabel)` — the sanctioned
 * tooltip mechanism (same as ChatHeader / SettingsTab), not the raw `title`
 * attribute, so the tooltip is themed consistently.
 *
 * Reproduce-first: against the unfixed TabBar, `setTooltip` is never imported
 * or called, so both assertions fail (red). The fix turns them green.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

const h = vi.hoisted(() => ({ setTooltipMock: vi.fn() }));
const setTooltipMock = h.setTooltipMock;

vi.mock("obsidian", () => {
	class Menu {
		addItem() {
			return this;
		}
		addSeparator() {
			return this;
		}
		showAtMouseEvent() {}
		showAtPosition() {}
		onHide() {}
	}
	return { Menu, setIcon: vi.fn(), setTooltip: h.setTooltipMock };
});

import { TabBar, type TabBarProps } from "../TabBar";
import type { TabInfo } from "../../types/tab";

const LONG_LABEL =
	"A very long note title that definitely exceeds the tab max width";

function tab(partial: Partial<TabInfo>): TabInfo {
	return {
		tabId: partial.tabId ?? "t1",
		agentId: partial.agentId ?? "kiro-cli",
		origin: "fresh",
		label: partial.label ?? "Tab",
		state: partial.state ?? "ready",
		createdAt: partial.createdAt ?? new Date(0),
	};
}

function baseProps(over: Partial<TabBarProps>): TabBarProps {
	return {
		tabs: [tab({ tabId: "t1", label: "A" })],
		activeTabId: "t1",
		onSelectTab: vi.fn(),
		onAddTab: vi.fn(),
		onCloseTab: vi.fn(),
		onCloseOtherTabs: vi.fn(),
		onCloseTabsToRight: vi.fn(),
		onRenameTab: vi.fn(),
		onMoveTab: vi.fn(),
		...over,
	};
}

beforeEach(() => {
	setTooltipMock.mockClear();
});

describe("tab label hover tooltip (TS-I05)", () => {
	it("sets the full label as an Obsidian tooltip on the tab element", () => {
		render(
			<TabBar
				{...baseProps({
					tabs: [tab({ tabId: "t1", label: LONG_LABEL })],
				})}
			/>,
		);

		// setTooltip(el, fullLabel) was called with the tab element.
		const call = setTooltipMock.mock.calls.find((c) => c[1] === LONG_LABEL);
		expect(
			call,
			"setTooltip should be called with the full tab label",
		).toBeTruthy();
		const el = call![0] as HTMLElement;
		expect(el).toBeInstanceOf(HTMLElement);
		expect(el.classList.contains("agent-client-tab")).toBe(true);
	});

	it("updates the tooltip when the label changes (e.g. AI rename)", () => {
		const { rerender } = render(
			<TabBar
				{...baseProps({
					tabs: [tab({ tabId: "t1", label: "old title" })],
				})}
			/>,
		);
		expect(
			setTooltipMock.mock.calls.some((c) => c[1] === "old title"),
		).toBe(true);

		setTooltipMock.mockClear();
		rerender(
			<TabBar
				{...baseProps({
					tabs: [tab({ tabId: "t1", label: "renamed title" })],
				})}
			/>,
		);
		expect(
			setTooltipMock.mock.calls.some((c) => c[1] === "renamed title"),
		).toBe(true);
	});
});
