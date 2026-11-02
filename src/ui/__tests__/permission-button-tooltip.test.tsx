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
import { render, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
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
afterEach(() => cleanup());

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

// Kiro V3 S5 option (a): a persistent choice opens a scope step (this vault
// by default, or this chat; exact command or Kiro's pattern) before it's sent.
describe("PermissionBanner – Kiro V3 scope step", () => {
	const offer = { workspace: true, resource: "npm run test", pattern: "npm *" };
	const request = {
		requestId: "r2",
		options: [
			{ optionId: "a", name: "Allow", kind: "allow_once" as const },
			{ optionId: "b", name: "Always allow", kind: "allow_always" as const, scopeOffer: offer },
		],
	};

	it("a one-time option is sent at once", () => {
		const approve = vi.fn().mockResolvedValue(undefined);
		const { getByText } = render(<PermissionBanner permissionRequest={request} onApprovePermission={approve} />);
		fireEvent.click(getByText("Allow"));
		expect(approve).toHaveBeenCalledWith("r2", "a");
	});

	it("Always allow opens the step; Confirm sends this vault + exact command by default", () => {
		const approve = vi.fn().mockResolvedValue(undefined);
		const { getByText, getByRole, queryByText } = render(
			<PermissionBanner permissionRequest={request} onApprovePermission={approve} />,
		);
		fireEvent.click(getByText("Always allow"));
		expect(approve).not.toHaveBeenCalled();
		expect(queryByText("Allow")).toBeNull();
		expect((getByRole("radio", { name: "This vault" }) as HTMLInputElement).checked).toBe(true);
		expect((getByRole("radio", { name: /This exact command/ }) as HTMLInputElement).checked).toBe(true);
		fireEvent.click(getByRole("button", { name: "Always allow" }));
		expect(approve).toHaveBeenCalledWith("r2", "b", { scope: "workspace", match: "exact" });
	});

	it("the user can pick this chat and the pattern", () => {
		const approve = vi.fn().mockResolvedValue(undefined);
		const { getByText, getByRole } = render(<PermissionBanner permissionRequest={request} onApprovePermission={approve} />);
		fireEvent.click(getByText("Always allow"));
		fireEvent.click(getByRole("radio", { name: "This chat only" }));
		fireEvent.click(getByRole("radio", { name: /npm \*/ }));
		fireEvent.click(getByRole("button", { name: "Always allow" }));
		expect(approve).toHaveBeenCalledWith("r2", "b", { scope: "session", match: "pattern" });
	});

	it("Back returns to the choices without sending anything", () => {
		const approve = vi.fn().mockResolvedValue(undefined);
		const { getByText, getByRole } = render(<PermissionBanner permissionRequest={request} onApprovePermission={approve} />);
		fireEvent.click(getByText("Always allow"));
		fireEvent.click(getByRole("button", { name: "Back" }));
		expect(getByText("Allow")).toBeTruthy();
		expect(approve).not.toHaveBeenCalled();
	});

	it("without a workspace root or a pattern, those choices aren't shown", () => {
		const approve = vi.fn().mockResolvedValue(undefined);
		const bare = { ...request, options: [{ ...request.options[1], scopeOffer: { workspace: false, resource: "ls" } }] };
		const { getByText, queryByRole, getByRole } = render(<PermissionBanner permissionRequest={bare} onApprovePermission={approve} />);
		fireEvent.click(getByText("Always allow"));
		expect(queryByRole("radio", { name: "This vault" })).toBeNull();
		expect(queryByRole("radio", { name: /exact command/ })).toBeNull();
		fireEvent.click(getByRole("button", { name: "Always allow" }));
		expect(approve).toHaveBeenCalledWith("r2", "b", { scope: "session", match: "exact" });
	});
});
