/**
 * Layer-edge guard — the dependency flow documented in ARCHITECTURE.md, made
 * falsifiable.
 *
 * CONTRIBUTING.md declares the layer principles ("services have zero React
 * imports", "types have zero deps") but until this test only two of them had
 * any enforcement (the ACP SDK boundary and the resolver purity zone, both in
 * eslint.config.mjs). The rest were convention — and a 2026-07-29 audit found
 * 17 backwards imports across 7 edge types, including `hooks → ui` (5) that no
 * probe had ever looked for.
 *
 * The model: `utils` is a SHARED LEAF, not a layer. It has universal fan-in
 * (every layer imports it, including `acp` at the bottom of the stack), so it
 * has no vertical slot — instead it is importable from everywhere and may
 * itself import only `types` and `i18n`. The vertical stack above the leaves:
 *
 *      types < i18n < utils            (leaves, in that order)
 *      acp, resolvers                  (bottom of the stack, peers — no cross)
 *      services                        (may reach acp)
 *      hooks                           (may reach services, resolvers, acp)
 *      ui                              (may reach everything below)
 *
 * `src/plugin.ts` and other root-level files are the composition root and are
 * exempt — wiring every layer together is their job.
 *
 * The GRANDFATHERED list pins the 8 known violations (2026-07-30). They are
 * NOT asserted to be correct — several look like misfiled artifacts (the
 * `services → ui` pair imports a view-type constant; the modal/focus imports
 * in `hooks → ui` are candidates for inversion). The list is exact in both
 * directions: a new backwards edge fails, and a fixed one must be removed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname, normalize, join } from "node:path";
import { execSync } from "node:child_process";

const repoRoot = process.cwd();

/** Leaf/stack rank. A module may import strictly lower ranks only. */
const RANK: Record<string, number> = {
	types: 0,
	i18n: 1,
	utils: 2,
	acp: 3,
	resolvers: 3, // peer of acp — neither may import the other (enforced by rank equality)
	services: 4,
	hooks: 5,
	ui: 6,
};

/** file -> imported layer, for edges that predate the guard. Keep exact. */
const GRANDFATHERED: Record<string, string> = {
	// a2ui capability negotiation sits in services but is consumed at the ACP
	// boundary. Candidate fix: move the capability module into acp/ or types/.
	"src/acp/acp-client.ts -> services": "pending triage — catalogued 2026-07-30",
	// Hooks that open concrete UI (modals, composer focus). Candidate fix:
	// invert via a port the ui layer registers.
	"src/hooks/useChatActions.ts -> ui": "pending triage — catalogued 2026-07-30",
	"src/hooks/useComposerFocusReturn.ts -> ui": "pending triage — catalogued 2026-07-30",
	"src/hooks/useHistoryModal.ts -> ui": "pending triage — catalogued 2026-07-30",
	"src/hooks/useLandingHistoryModal.ts -> ui": "pending triage — catalogued 2026-07-30",
	// Both import the VIEW_TYPE_CHAT constant. It stays in ui/ deliberately
	// (its docblock records the I157 collision rationale for living beside the
	// view); the constant-only import is benign but still a backwards edge.
	"src/services/migrate-legacy-view-type.ts -> ui": "constant-only (VIEW_TYPE_CHAT) — catalogued 2026-07-30",
	"src/services/register-chat-view.ts -> ui": "constant-only (VIEW_TYPE_CHAT) — catalogued 2026-07-30",
};

const IMPORT_RE = /^\s*import\s+(?:type\s+)?[^"']*from\s+["'](\.[^"']+)["']/gm;

function layerOf(relPath: string): string | null {
	const parts = relPath.split("/");
	if (parts[0] !== "src" || parts.length < 2) return null;
	const candidate = parts[1].replace(/\.(ts|tsx|d\.ts)$/, "");
	return candidate in RANK ? candidate : null; // src/plugin.ts etc. -> null (composition root)
}

interface Edge {
	key: string;
	from: string;
	fromLayer: string;
	toLayer: string;
}

function scan(): Edge[] {
	const files = execSync(
		"git ls-files --cached --others --exclude-standard 'src/**/*.ts' 'src/**/*.tsx'",
		{ cwd: repoRoot, encoding: "utf8" },
	)
		.split("\n")
		.filter(Boolean)
		.filter(
			(f) =>
				!f.includes("__tests__") &&
				!f.includes("__test_stubs__") &&
				!f.endsWith(".test.ts") &&
				!f.endsWith(".test.tsx"),
		);

	const edges: Edge[] = [];
	for (const file of files) {
		const fromLayer = layerOf(file);
		if (!fromLayer) continue;
		const src = readFileSync(resolve(repoRoot, file), "utf8");
		for (const m of src.matchAll(IMPORT_RE)) {
			const target = normalize(join(dirname(file), m[1]));
			const toLayer = layerOf(target.split("\\").join("/"));
			if (!toLayer || toLayer === fromLayer) continue;
			edges.push({ key: `${file} -> ${toLayer}`, from: file, fromLayer, toLayer });
		}
	}
	return edges;
}

const edges = scan();
const violations = edges.filter((e) => RANK[e.toLayer] >= RANK[e.fromLayer]);

describe("layer edges", () => {
	// Self-test: an import regex that matched nothing would pass everything.
	it("the scanner sees the well-known legal edges", () => {
		const kinds = new Set(edges.map((e) => `${e.fromLayer}->${e.toLayer}`));
		expect(kinds).toContain("ui->hooks");
		expect(kinds).toContain("hooks->services");
		expect(kinds).toContain("services->acp");
		expect(kinds).toContain("utils->types");
	});

	it("types imports no other layer (zero-deps tenet)", () => {
		expect(edges.filter((e) => e.fromLayer === "types").map((e) => e.key)).toEqual([]);
	});

	it("every backwards edge is grandfathered", () => {
		const unlisted = [...new Set(violations.map((v) => v.key))]
			.filter((k) => !(k in GRANDFATHERED))
			.sort();
		expect(
			unlisted,
			[
				"New backwards layer edge(s). The dependency flow is",
				"types < i18n < utils (leaves) then acp|resolvers < services < hooks < ui.",
				"Either import from a lower layer (move the shared type into types/,",
				"or invert via a port), or add the edge to GRANDFATHERED with a reason.",
				"",
				`Unlisted: ${unlisted.join(", ")}`,
			].join("\n"),
		).toEqual([]);
	});

	it("no grandfathered edge is stale", () => {
		const present = new Set(violations.map((v) => v.key));
		const stale = Object.keys(GRANDFATHERED)
			.filter((k) => !present.has(k))
			.sort();
		expect(
			stale,
			`Fixed edge(s) still listed — remove from GRANDFATHERED: ${stale.join(", ")}`,
		).toEqual([]);
	});
});
