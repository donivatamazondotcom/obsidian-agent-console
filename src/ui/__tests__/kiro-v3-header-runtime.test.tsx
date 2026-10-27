/**
 * Kiro CLI V3 S2: the header tooltip's Runtime line.
 *
 * V3 sends no `agentInfo` in `initialize` (verified live on kiro-cli
 * 2.34.2-nightly.1, 2026-10-26), so the tooltip's Runtime line fell back to
 * "Connecting…" for the whole life of a ready session. Fix, per the 2026-10-26
 * decision (a1):
 *   - agent reported `agentInfo` → its title/name + version (unchanged)
 *   - Kiro CLI on the V3 engine, nothing reported → "Kiro CLI (V3 engine)"
 *   - anything else with nothing reported → no Runtime line once ready
 * "Connecting…" shows only while the session is genuinely connecting, the same
 * gate the visible model slot uses (I80). The Model line gets the same gate.
 *
 * Red-first (R1): `deriveHeaderRuntime` does not exist before S2, and the
 * ready-tooltip cases render "Connecting…".
 *
 * Spec: [[Kiro CLI V3 Support]] § S2.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { deriveHeaderRuntime } from "../../resolvers/header-agent";
import { ChatHeader, type HeaderSegments } from "../ChatHeader";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
vi.mock("obsidian", () => ({ setIcon: vi.fn() }));

describe("deriveHeaderRuntime", () => {
	it("reported agentInfo wins, with title and version", () => {
		expect(
			deriveHeaderRuntime({
				agentInfo: { name: "test-agent", title: "Test Agent", version: "1.2.3" },
				isKiroV3: true,
			}),
		).toEqual({ kind: "reported", label: "Test Agent 1.2.3" });
		expect(
			deriveHeaderRuntime({ agentInfo: { name: "test-agent" }, isKiroV3: false }),
		).toEqual({ kind: "reported", label: "test-agent" });
	});

	it("Kiro CLI V3 with no agentInfo → kiroV3", () => {
		expect(deriveHeaderRuntime({ isKiroV3: true })).toEqual({ kind: "kiroV3" });
	});

	it("anything else with no agentInfo → unknown", () => {
		expect(deriveHeaderRuntime({ isKiroV3: false })).toEqual({ kind: "unknown" });
	});
});

function tooltipFor(overrides: Partial<HeaderSegments>): string {
	const segments: HeaderSegments = {
		plugin: "Agent Console",
		profile: "Test Agent",
		runtime: null,
		model: null,
		...overrides,
	};
	const { container } = render(
		<ChatHeader
			agentLabel="Test Agent"
			headerSegments={segments}
			isUpdateAvailable={false}
			onUpdateClick={vi.fn()}
			onReload={vi.fn()}
			onExportChat={vi.fn()}
			onShowMenu={vi.fn()}
		/>,
	);
	return (
		container
			.querySelector(".agent-client-chat-view-header-title")
			?.getAttribute("aria-label") ?? ""
	);
}

describe("ChatHeader tooltip Runtime/Model lines", () => {
	it("ready V3 session: shows the fallback runtime, never 'Connecting…'", () => {
		const tip = tooltipFor({
			runtime: "Kiro CLI (V3 engine)",
			model: "Test model",
			isConnecting: false,
		});
		expect(tip).toContain("Runtime: Kiro CLI (V3 engine)");
		expect(tip).not.toContain("Connecting");
	});

	it("ready session with nothing reported: omits the lines instead of 'Connecting…'", () => {
		const tip = tooltipFor({ isConnecting: false });
		expect(tip).not.toContain("Connecting");
		expect(tip).not.toContain("Runtime:");
		expect(tip).not.toContain("Model:");
		expect(tip).toContain("Test Agent");
	});

	it("genuinely connecting: both lines say 'Connecting…'", () => {
		const tip = tooltipFor({ isConnecting: true });
		expect(tip).toMatch(/Runtime: Connecting…/);
		expect(tip).toMatch(/Model:\s+Connecting…/);
	});
});
