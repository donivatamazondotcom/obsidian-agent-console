/**
 * V02–V14 — the buttons-v0 trust boundary. Total, no-throw, tagged-union.
 *
 * Ports the feasibility probe's validator checks (vault spec § Validator
 * spec). T06 acceptance test is exercised at this seam; T10 (tolerated
 * inbound shapes) has its truth-table rows here.
 */
import { describe, expect, it } from "vitest";
import {
	A2UI_BASIC_CATALOG_ID,
	BUTTONS_V0_CATALOG_ID,
} from "../spec-snapshot";
import { validateA2uiFence } from "../validator";
import type { A2uiComponent } from "../types";

/** Hand-built valid envelope mirroring the briefing's canonical example. */
function makeEnvelope(overrides: {
	version?: unknown;
	surfaceId?: unknown;
	catalogId?: unknown;
	components?: unknown;
	extraCreateSurface?: Record<string, unknown>;
	extraTopLevel?: Record<string, unknown>;
} = {}): string {
	const createSurface: Record<string, unknown> = {
		surfaceId: overrides.surfaceId ?? "migration-scope-7f3a",
		catalogId: overrides.catalogId ?? BUTTONS_V0_CATALOG_ID,
		components: overrides.components ?? [
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
		...overrides.extraCreateSurface,
	};
	return JSON.stringify({
		version: overrides.version ?? "v1.0",
		createSurface,
		...overrides.extraTopLevel,
	});
}

function expectInvalid(body: string, code: string): void {
	const result = validateA2uiFence(body);
	expect(result.kind).toBe("invalid");
	if (result.kind === "invalid") {
		expect(result.violations.map((v) => v.code)).toContain(code);
	}
}

describe("validateA2uiFence — happy path", () => {
	it("accepts the canonical two-button envelope and resolves labels", () => {
		const result = validateA2uiFence(makeEnvelope());
		expect(result.kind).toBe("valid");
		if (result.kind !== "valid") return;
		expect(result.surface.surfaceId).toBe("migration-scope-7f3a");
		expect(result.surface.rootId).toBe("root");
		expect(result.surface.components.size).toBe(5);
		expect(result.surface.tolerated).toEqual({
			version: false,
			catalog: false,
		});
		const minimal = result.surface.components.get("minimal");
		expect(minimal?.kind).toBe("button");
		if (minimal?.kind === "button") {
			expect(minimal.label).toBe("Minimal migration");
			expect(minimal.event.name).toBe("choose_scope");
			expect(minimal.event.context).toEqual({ scope: "minimal" });
		}
	});

	it("accepts Card with a single child (spec shape) and with children (corpus shape)", () => {
		for (const card of [
			{ id: "card", component: "Card", child: "label" },
			{ id: "card", component: "Card", children: ["label"] },
		]) {
			const result = validateA2uiFence(
				makeEnvelope({
					components: [
						{ id: "root", component: "Column", children: ["card"] },
						card,
						{ id: "label", component: "Text", text: "hello" },
					],
				}),
			);
			expect(result.kind).toBe("valid");
		}
	});

	it("accepts Divider as a leaf and numeric/boolean context literals", () => {
		const result = validateA2uiFence(
			makeEnvelope({
				components: [
					{ id: "root", component: "Column", children: ["div", "b"] },
					{ id: "div", component: "Divider" },
					{ id: "b-label", component: "Text", text: "Go" },
					{
						id: "b",
						component: "Button",
						child: "b-label",
						action: {
							event: {
								name: "go",
								context: { count: 3, force: true, note: "x" },
							},
						},
					},
				],
			}),
		);
		expect(result.kind).toBe("valid");
	});
});

describe("validateA2uiFence — V02/V03 line and JSON shape", () => {
	it("rejects multi-line bodies", () => {
		expectInvalid(makeEnvelope() + "\n" + makeEnvelope(), "not-single-line");
	});

	it("rejects empty bodies", () => {
		expectInvalid("", "not-single-line");
		expectInvalid("\n\n", "not-single-line");
	});

	it("rejects invalid JSON", () => {
		expectInvalid("{not json", "invalid-json");
		expectInvalid("prose pretending", "invalid-json");
	});

	it("rejects non-object JSON", () => {
		expectInvalid("42", "bad-envelope");
		expectInvalid('"string"', "bad-envelope");
		expectInvalid("[1,2]", "bad-envelope");
		expectInvalid("null", "bad-envelope");
	});
});

describe("validateA2uiFence — V04 envelope", () => {
	it("rejects non-createSurface message types", () => {
		expectInvalid(
			'{"version":"v1.0","deleteSurface":{"surfaceId":"x-1a2b"}}',
			"bad-envelope",
		);
		expectInvalid(
			'{"version":"v1.0","updateComponents":{"surfaceId":"x-1a2b","components":[]}}',
			"bad-envelope",
		);
		expectInvalid(
			'{"version":"v1.0","action":{"name":"n","surfaceId":"x-1a2b","sourceComponentId":"b","timestamp":"t","context":{}}}',
			"bad-envelope",
		);
	});

	it("rejects envelopes with extra top-level keys", () => {
		expectInvalid(
			makeEnvelope({ extraTopLevel: { updateDataModel: {} } }),
			"bad-envelope",
		);
	});

	it("rejects envelopes with no message key", () => {
		expectInvalid('{"version":"v1.0"}', "bad-envelope");
	});
});

describe("validateA2uiFence — V05 version (D5: strict out, tolerant in)", () => {
	it("rejects unknown versions", () => {
		expectInvalid(makeEnvelope({ version: "v2.0" }), "bad-version");
		expectInvalid(makeEnvelope({ version: 1 }), "bad-version");
	});

	it("rejects a missing version", () => {
		const body = makeEnvelope();
		const parsed = JSON.parse(body) as Record<string, unknown>;
		delete parsed.version;
		expectInvalid(JSON.stringify(parsed), "bad-version");
	});

	it("tolerates v0.9.1 and records it (T10)", () => {
		const result = validateA2uiFence(makeEnvelope({ version: "v0.9.1" }));
		expect(result.kind).toBe("valid");
		if (result.kind === "valid") {
			expect(result.surface.tolerated.version).toBe(true);
		}
	});
});

describe("validateA2uiFence — V06 surfaceId", () => {
	it("rejects non-kebab-case ids", () => {
		expectInvalid(makeEnvelope({ surfaceId: "Bad_Id" }), "bad-surface-id");
		expectInvalid(makeEnvelope({ surfaceId: "-leading" }), "bad-surface-id");
		expectInvalid(makeEnvelope({ surfaceId: "" }), "bad-surface-id");
		expectInvalid(makeEnvelope({ surfaceId: 7 }), "bad-surface-id");
	});

	it("rejects a surfaceId already seen in the session (first wins)", () => {
		const result = validateA2uiFence(makeEnvelope(), {
			existingSurfaceIds: new Set(["migration-scope-7f3a"]),
		});
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.violations.map((v) => v.code)).toContain(
				"duplicate-surface-id",
			);
		}
	});
});

describe("validateA2uiFence — V07 catalog (D10)", () => {
	it("rejects unknown catalog ids", () => {
		expectInvalid(
			makeEnvelope({ catalogId: "https://example.com/catalog" }),
			"bad-catalog",
		);
		const parsed = JSON.parse(makeEnvelope()) as {
			createSurface: Record<string, unknown>;
		};
		delete parsed.createSurface.catalogId;
		expectInvalid(JSON.stringify(parsed), "bad-catalog");
	});

	it("tolerates the Basic Catalog id under the same profile subset (T10)", () => {
		const result = validateA2uiFence(
			makeEnvelope({ catalogId: A2UI_BASIC_CATALOG_ID }),
		);
		expect(result.kind).toBe("valid");
		if (result.kind === "valid") {
			expect(result.surface.tolerated.catalog).toBe(true);
		}
	});

	it("still enforces the profile subset under the tolerated Basic id", () => {
		expectInvalid(
			makeEnvelope({
				catalogId: A2UI_BASIC_CATALOG_ID,
				components: [
					{ id: "root", component: "Column", children: ["img"] },
					{ id: "img", component: "Image", url: "https://x.test/a.png" },
				],
			}),
			"unknown-component-type",
		);
	});
});

describe("validateA2uiFence — V08 components", () => {
	it("rejects missing, non-array, or empty components", () => {
		const parsed = JSON.parse(makeEnvelope()) as {
			createSurface: Record<string, unknown>;
		};
		delete parsed.createSurface.components;
		expectInvalid(JSON.stringify(parsed), "bad-components");
		expectInvalid(makeEnvelope({ components: {} }), "bad-components");
		expectInvalid(makeEnvelope({ components: [] }), "bad-components");
	});

	it("rejects a component list without a root", () => {
		expectInvalid(
			makeEnvelope({
				components: [{ id: "a", component: "Text", text: "x" }],
			}),
			"missing-root",
		);
	});

	it("rejects duplicate component ids", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Column", children: ["a"] },
					{ id: "a", component: "Text", text: "x" },
					{ id: "a", component: "Text", text: "y" },
				],
			}),
			"duplicate-component-id",
		);
	});
});

describe("validateA2uiFence — V09 component types", () => {
	it.each(["Image", "Video", "AudioPlayer", "Modal", "Tabs", "List", "TextField", "CheckBox", "ChoicePicker", "Slider", "Icon"])(
		"rejects out-of-profile component %s (D12)",
		(type) => {
			expectInvalid(
				makeEnvelope({
					components: [
						{ id: "root", component: "Column", children: ["x"] },
						{ id: "x", component: type },
					],
				}),
				"unknown-component-type",
			);
		},
	);

	it("rejects invented component types", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Grid", children: [] },
				],
			}),
			"unknown-component-type",
		);
	});
});

describe("validateA2uiFence — V10 graph", () => {
	it("rejects dangling child references", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Row", children: ["ghost"] },
				],
			}),
			"dangling-ref",
		);
	});

	it("rejects cycles", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Row", children: ["a"] },
					{ id: "a", component: "Column", children: ["root"] },
				],
			}),
			"cycle",
		);
	});

	it("rejects trees deeper than 8", () => {
		const components: Record<string, unknown>[] = [];
		for (let i = 0; i < 9; i++) {
			components.push({
				id: i === 0 ? "root" : `n${i}`,
				component: "Column",
				children: i < 8 ? [`n${i + 1}`] : [],
			});
		}
		// depth 9: root(1) → n1(2) → … → n8(9)
		components[8] = { id: "n8", component: "Text", text: "leaf" };
		expectInvalid(makeEnvelope({ components }), "depth-exceeded");
	});

	it("accepts a tree of exactly depth 8", () => {
		const components: Record<string, unknown>[] = [];
		for (let i = 0; i < 8; i++) {
			components.push({
				id: i === 0 ? "root" : `n${i}`,
				component: "Column",
				children: i < 7 ? [`n${i + 1}`] : [],
			});
		}
		components[7] = { id: "n7", component: "Text", text: "leaf" };
		const result = validateA2uiFence(makeEnvelope({ components }));
		expect(result.kind).toBe("valid");
	});
});

describe("validateA2uiFence — V11 button contract", () => {
	it("rejects a button whose child is not a Text", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Row", children: ["b"] },
					{ id: "lbl", component: "Divider" },
					{
						id: "b",
						component: "Button",
						child: "lbl",
						action: { event: { name: "go", context: {} } },
					},
				],
			}),
			"bad-button",
		);
	});

	it("rejects a button without an action event name", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Row", children: ["b"] },
					{ id: "lbl", component: "Text", text: "Go" },
					{ id: "b", component: "Button", child: "lbl", action: { event: { context: {} } } },
				],
			}),
			"bad-button",
		);
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Row", children: ["b"] },
					{ id: "lbl", component: "Text", text: "Go" },
					{ id: "b", component: "Button", child: "lbl" },
				],
			}),
			"bad-button",
		);
	});

	it("rejects non-UAX31 event names", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Row", children: ["b"] },
					{ id: "lbl", component: "Text", text: "Go" },
					{
						id: "b",
						component: "Button",
						child: "lbl",
						action: { event: { name: "has space", context: {} } },
					},
				],
			}),
			"bad-button",
		);
	});

	it("rejects non-literal context values (objects, arrays, null)", () => {
		for (const bad of [{ nested: 1 }, [1, 2], null]) {
			expectInvalid(
				makeEnvelope({
					components: [
						{ id: "root", component: "Row", children: ["b"] },
						{ id: "lbl", component: "Text", text: "Go" },
						{
							id: "b",
							component: "Button",
							child: "lbl",
							action: { event: { name: "go", context: { v: bad } } },
						},
					],
				}),
				"bad-button",
			);
		}
	});
});

describe("validateA2uiFence — V12 forbidden keys and identity (D12)", () => {
	it("rejects data-model bindings in Text", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Column", children: ["t"] },
					{ id: "t", component: "Text", text: { path: "/name" } },
				],
			}),
			"forbidden-key",
		);
	});

	it.each([
		["checks", { checks: [] }],
		["functionCall in action", { action: { functionCall: { call: "openUrl" } } }],
	])("rejects %s on a component", (_name, extra) => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Column", children: ["d"] },
					{ id: "d", component: "Divider", ...extra },
				],
			}),
			"forbidden-key",
		);
	});

	it("rejects dataModel / sendDataModel on createSurface", () => {
		expectInvalid(
			makeEnvelope({ extraCreateSurface: { dataModel: { a: 1 } } }),
			"forbidden-key",
		);
		expectInvalid(
			makeEnvelope({ extraCreateSurface: { sendDataModel: true } }),
			"forbidden-key",
		);
	});

	it("rejects agent-supplied identity fields in surfaceProperties", () => {
		expectInvalid(
			makeEnvelope({
				extraCreateSurface: {
					surfaceProperties: { agentDisplayName: "Trusted Bot" },
				},
			}),
			"identity-field",
		);
		expectInvalid(
			makeEnvelope({
				extraCreateSurface: {
					surfaceProperties: { iconUrl: "https://x.test/i.png" },
				},
			}),
			"identity-field",
		);
	});

	it("allows an empty surfaceProperties object", () => {
		const result = validateA2uiFence(
			makeEnvelope({ extraCreateSurface: { surfaceProperties: {} } }),
		);
		expect(result.kind).toBe("valid");
	});
});

describe("validateA2uiFence — V13 limits", () => {
	it("rejects more than 64 components", () => {
		const components: Record<string, unknown>[] = [
			{
				id: "root",
				component: "Column",
				children: Array.from({ length: 64 }, (_, i) => `t${i}`),
			},
		];
		for (let i = 0; i < 64; i++) {
			components.push({ id: `t${i}`, component: "Text", text: `x${i}` });
		}
		expectInvalid(makeEnvelope({ components }), "over-limit");
	});

	it("rejects strings over 2 kB", () => {
		expectInvalid(
			makeEnvelope({
				components: [
					{ id: "root", component: "Column", children: ["t"] },
					{ id: "t", component: "Text", text: "x".repeat(2049) },
				],
			}),
			"over-limit",
		);
	});

	it("rejects fences over 32 kB", () => {
		// 20 components × ~1.9 kB strings ≈ 39 kB total, each string within
		// the per-string limit — only the fence-size limit can catch it.
		const ids = Array.from({ length: 20 }, (_, i) => `t${i}`);
		const components: Record<string, unknown>[] = [
			{ id: "root", component: "Column", children: ids },
			...ids.map((id) => ({
				id,
				component: "Text",
				text: "y".repeat(1900),
			})),
		];
		expectInvalid(makeEnvelope({ components }), "over-limit");
	});
});

describe("validateA2uiFence — V14 orphans warn, not fail", () => {
	it("accepts orphan components and reports them", () => {
		const result = validateA2uiFence(
			makeEnvelope({
				components: [
					{ id: "root", component: "Column", children: ["t"] },
					{ id: "t", component: "Text", text: "shown" },
					{ id: "stray", component: "Text", text: "unreachable" },
				],
			}),
		);
		expect(result.kind).toBe("valid");
		if (result.kind === "valid") {
			expect(result.surface.orphanIds).toEqual(["stray"]);
		}
	});
});

describe("validateA2uiFence — total and no-throw (T06)", () => {
	it.each([
		"",
		"null",
		"{}",
		'{"version":null}',
		'{"createSurface":"nope"}',
		'{"version":"v1.0","createSurface":{"components":"nope"}}',
		'{"version":"v1.0","createSurface":{"surfaceId":["a"],"catalogId":{},"components":[{"id":null}]}}',
		"\u0000\uFFFF",
		"[[[[[[",
	])("never throws on hostile input %#", (body) => {
		expect(() => validateA2uiFence(body)).not.toThrow();
		const result = validateA2uiFence(body);
		expect(result.kind).toBe("invalid");
	});
});

describe("validated component union stays literal-only", () => {
	it("button context type admits only string/number/boolean", () => {
		// Compile-time guard: this test exists to keep the union honest.
		const c: A2uiComponent = {
			kind: "button",
			id: "b",
			child: "lbl",
			label: "Go",
			event: { name: "go", context: { a: "x", b: 1, c: true } },
		};
		expect(c.kind).toBe("button");
	});
});
