/**
 * Exhaustive truth table for deriveEmptyStateView (Slice 2 of
 * [[Agent Console Close Last Tab to Empty State]]).
 *
 * Four input rows (location × hasDetectedAgent) → the resolved reason + the
 * six affordance flags. This is the single source of truth both empty-state
 * surfaces read; the table below IS the § Harmonization matrix, encoded.
 */

import { describe, expect, it } from "vitest";
import {
	deriveEmptyStateView,
	type EmptyStateView,
} from "../empty-state-view";

describe("deriveEmptyStateView — exhaustive truth table", () => {
	const rows: Array<{
		name: string;
		location: "in-tab" | "no-tabs";
		hasDetectedAgent: boolean;
		expected: EmptyStateView;
	}> = [
		{
			name: "in-tab, agent detected → picks, Re-detect, settings, hint",
			location: "in-tab",
			hasDetectedAgent: true,
			expected: {
				reason: "no-agent-in-tab",
				showRedetect: true,
				showInstallRows: false,
				showAgentPicks: true,
				showLandingActions: false,
				showSettings: true,
				showManualPathHint: true,
			},
		},
		{
			name: "in-tab, no agent → install rows, Re-detect, settings, hint",
			location: "in-tab",
			hasDetectedAgent: false,
			expected: {
				reason: "no-agent-in-tab",
				showRedetect: true,
				showInstallRows: true,
				showAgentPicks: false,
				showLandingActions: false,
				showSettings: true,
				showManualPathHint: true,
			},
		},
		{
			name: "no-tabs, agent detected → landing actions only, NO Re-detect",
			location: "no-tabs",
			hasDetectedAgent: true,
			expected: {
				reason: "no-tabs",
				showRedetect: false,
				showInstallRows: false,
				showAgentPicks: false,
				showLandingActions: true,
				showSettings: false,
				showManualPathHint: false,
			},
		},
		{
			name: "no-tabs, no agent → install rows + Re-detect + settings + hint, no launch",
			location: "no-tabs",
			hasDetectedAgent: false,
			expected: {
				reason: "no-tabs-no-agent",
				showRedetect: true,
				showInstallRows: true,
				showAgentPicks: false,
				showLandingActions: false,
				showSettings: true,
				showManualPathHint: true,
			},
		},
	];

	for (const row of rows) {
		it(row.name, () => {
			expect(
				deriveEmptyStateView({
					location: row.location,
					hasDetectedAgent: row.hasDetectedAgent,
				}),
			).toEqual(row.expected);
		});
	}

	it("Re-detect is shown on every detection gap and hidden only on the detected landing", () => {
		// Governing rule: Re-detect appears wherever an agent could be missing
		// (in-tab always; landing when none detected) and is hidden only on the
		// neutral landing where an agent is already available.
		expect(
			deriveEmptyStateView({ location: "in-tab", hasDetectedAgent: true })
				.showRedetect,
		).toBe(true);
		expect(
			deriveEmptyStateView({ location: "in-tab", hasDetectedAgent: false })
				.showRedetect,
		).toBe(true);
		expect(
			deriveEmptyStateView({ location: "no-tabs", hasDetectedAgent: false })
				.showRedetect,
		).toBe(true);
		expect(
			deriveEmptyStateView({ location: "no-tabs", hasDetectedAgent: true })
				.showRedetect,
		).toBe(false);
	});

	it("only the detected landing offers the launch action set", () => {
		expect(
			deriveEmptyStateView({ location: "no-tabs", hasDetectedAgent: true })
				.showLandingActions,
		).toBe(true);
		for (const inp of [
			{ location: "in-tab", hasDetectedAgent: true } as const,
			{ location: "in-tab", hasDetectedAgent: false } as const,
			{ location: "no-tabs", hasDetectedAgent: false } as const,
		]) {
			expect(deriveEmptyStateView(inp).showLandingActions).toBe(false);
		}
	});
});
