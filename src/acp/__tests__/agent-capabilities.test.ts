/**
 * Mapping-table tests for AcpTypeConverter.toAgentCapabilities (Agent
 * Capability Normalization, track B of [[Resolver and Single-Writer
 * Refactors]]).
 *
 * The normalizer is the single anti-corruption boundary that maps the raw
 * ACP `initialize` capability bag (RawAgentCapabilities) into the uniform,
 * total `AgentCapabilities` domain record the rest of the app consumes. No
 * field is `undefined`-means-something: every axis is an explicit boolean.
 *
 * Each row pins one agent `initialize` shape → its expected normalized
 * record. The two divergent real profiles (Claude Code = load-only;
 * Kiro CLI = list+resume+fork) are called out explicitly because they are
 * the source of the session-history / header divergences this normalization
 * removes the root of (I09 / I41 / I80).
 */

import { describe, it, expect } from "vitest";
import { AcpTypeConverter } from "../type-converter";
import {
	NO_AGENT_CAPABILITIES,
	type AgentCapabilities,
	type RawAgentCapabilities,
} from "../../types/session";

interface MappingRow {
	name: string;
	raw: RawAgentCapabilities | undefined;
	expected: AgentCapabilities;
}

const rows: MappingRow[] = [
	{
		name: "undefined (agent advertised no capabilities)",
		raw: undefined,
		expected: {
			listsSessions: false,
			restoresViaLoad: false,
			restoresViaResume: false,
			forks: false,
			reportsModels: false,
		},
	},
	{
		name: "empty bag {}",
		raw: {},
		expected: {
			listsSessions: false,
			restoresViaLoad: false,
			restoresViaResume: false,
			forks: false,
			reportsModels: false,
		},
	},
	{
		name: "Claude Code profile (loadSession only)",
		raw: { loadSession: true },
		expected: {
			listsSessions: false,
			restoresViaLoad: true,
			restoresViaResume: false,
			forks: false,
			reportsModels: false,
		},
	},
	{
		name: "Kiro CLI profile (list + resume + fork, no loadSession)",
		raw: {
			loadSession: false,
			sessionCapabilities: { list: {}, resume: {}, fork: {} },
		},
		expected: {
			listsSessions: true,
			restoresViaLoad: false,
			restoresViaResume: true,
			forks: true,
			reportsModels: false,
		},
	},
	{
		name: "list-only",
		raw: { sessionCapabilities: { list: {} } },
		expected: {
			listsSessions: true,
			restoresViaLoad: false,
			restoresViaResume: false,
			forks: false,
			reportsModels: false,
		},
	},
	{
		name: "resume-only",
		raw: { sessionCapabilities: { resume: {} } },
		expected: {
			listsSessions: false,
			restoresViaLoad: false,
			restoresViaResume: true,
			forks: false,
			reportsModels: false,
		},
	},
	{
		name: "fork-only",
		raw: { sessionCapabilities: { fork: {} } },
		expected: {
			listsSessions: false,
			restoresViaLoad: false,
			restoresViaResume: false,
			forks: true,
			reportsModels: false,
		},
	},
	{
		name: "loadSession false is not a restore-via-load",
		raw: { loadSession: false },
		expected: {
			listsSessions: false,
			restoresViaLoad: false,
			restoresViaResume: false,
			forks: false,
			reportsModels: false,
		},
	},
	{
		name: "empty sessionCapabilities object (present but no sub-caps)",
		raw: { loadSession: true, sessionCapabilities: {} },
		expected: {
			listsSessions: false,
			restoresViaLoad: true,
			restoresViaResume: false,
			forks: false,
			reportsModels: false,
		},
	},
	{
		name: "full capabilities (load + list + resume + fork)",
		raw: {
			loadSession: true,
			sessionCapabilities: { list: {}, resume: {}, fork: {} },
			mcpCapabilities: { http: true, sse: false },
			promptCapabilities: {
				image: true,
				audio: false,
				embeddedContext: true,
			},
		},
		expected: {
			listsSessions: true,
			restoresViaLoad: true,
			restoresViaResume: true,
			forks: true,
			reportsModels: false,
		},
	},
];

describe("AcpTypeConverter.toAgentCapabilities", () => {
	it.each(rows)("$name", ({ raw, expected }) => {
		expect(AcpTypeConverter.toAgentCapabilities(raw)).toEqual(expected);
	});

	it("never reports models at this ACP SDK version (single wire-point)", () => {
		// SDK 0.14.1 exposes no model capability in `initialize`; reportsModels
		// is total-and-explicit but currently always false. If this ever flips,
		// it must flip in the normalizer, not by re-scattering raw reads.
		for (const { raw } of rows) {
			expect(AcpTypeConverter.toAgentCapabilities(raw).reportsModels).toBe(
				false,
			);
		}
	});

	it("NO_AGENT_CAPABILITIES equals the normalization of an absent bag", () => {
		expect(AcpTypeConverter.toAgentCapabilities(undefined)).toEqual(
			NO_AGENT_CAPABILITIES,
		);
	});
});
