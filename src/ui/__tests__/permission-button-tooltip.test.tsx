/**
 * Permission option button — full label as a hover tooltip (I158).
 *
 * The permission button renders the option name (e.g.
 * "Always Allow Bash(ls -la ~/notes/reports/quarterly-summary.pdf 2>&1),
 * Read(~/notes/reports/**)") directly as its text. In a narrow
 * sidebar the button overflows the leaf on both sides and the label is
 * unreadable. The fix CSS-truncates the label and mirrors the TabBar
 * precedent: reveal the full text with Obsidian's sanctioned setTooltip()
 * (same mechanism as TabBar / ChatHeader / SettingsTab), not a raw `title`.
 *
 * Reproduce-first: against the unfixed PermissionBanner, setTooltip is never
 * imported or called, so both assertions fail (red). The fix turns them green.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

const h = vi.hoisted(() => ({ setTooltipMock: vi.fn() }));
const setTooltipMock = h.setTooltipMock;

vi.mock("obsidian", () => ({ setTooltip: h.setTooltipMock }));

import { PermissionBanner } from "../PermissionBanner";
import type { PermissionOption } from "../../types/chat";

const LONG_NAME =
	"Always Allow Bash(ls -la ~/notes/reports/quarterly-summary.pdf 2>&1), Read(~/notes/reports/**)";

function opt(partial: Partial<PermissionOption>): PermissionOption {
	return {
		optionId: partial.optionId ?? "o1",
		name: partial.name ?? "Allow",
		kind: partial.kind,
	} as PermissionOption;
}

beforeEach(() => {
	setTooltipMock.mockClear();
});

describe("permission option button tooltip (I158)", () => {
	it("sets the full option name as an Obsidian tooltip on the button", () => {
		render(
			<PermissionBanner
				permissionRequest={{
					requestId: "r1",
					options: [opt({ optionId: "o1", name: LONG_NAME })],
				}}
				onApprovePermission={vi.fn()}
			/>,
		);

		const call = setTooltipMock.mock.calls.find((c) => c[1] === LONG_NAME);
		expect(
			call,
			"setTooltip should be called with the full option name",
		).toBeTruthy();
		const el = call![0] as HTMLElement;
		expect(el).toBeInstanceOf(HTMLElement);
		expect(el.classList.contains("agent-client-permission-option")).toBe(
			true,
		);
	});

	it("renders the label in a truncatable label span", () => {
		const { container } = render(
			<PermissionBanner
				permissionRequest={{
					requestId: "r1",
					options: [opt({ optionId: "o1", name: LONG_NAME })],
				}}
				onApprovePermission={vi.fn()}
			/>,
		);
		const label = container.querySelector(
			".agent-client-permission-option-label",
		);
		expect(label, "label span should exist").toBeTruthy();
		expect(label!.textContent).toBe(LONG_NAME);
	});
});
