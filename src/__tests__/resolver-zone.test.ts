/**
 * Resolver-zone guard — a new `derive*` / `decide*` decision function belongs in
 * `src/resolvers/`, or on the grandfather list below with a reason.
 *
 * Why this exists: the `src/resolvers/**` ESLint override bans React / Obsidian
 * / raw-SDK imports and (since the design-integrity P1 pass) enforces strict
 * switch exhaustiveness with no `default` escape hatch. But that override is
 * **location-scoped** — it only constrains files already inside the folder.
 * Nothing stopped a new decision function from being written in `utils/` or
 * `services/` instead, where none of those guards apply. The enforcement
 * gradient was inverted: the constrained path was the *correct* one, so the
 * cheapest way to write an impure resolver was to put it anywhere else.
 *
 * This test flips the default. The zone becomes opt-out-with-a-reason rather
 * than opt-in, so adding a decision function outside it is a visible decision
 * in the diff instead of a silent one.
 *
 * Scope note: only `derive*` / `decide*` are checked — that is the naming
 * convention the resolver tenet establishes. `resolve*` is deliberately NOT
 * checked: it is used across the codebase for impure I/O helpers
 * (`resolveCommandPath`, `resolveShellPath`), so including it would flood the
 * list with functions that were never resolvers.
 *
 * The 20 grandfathered entries were catalogued when this guard shipped
 * (2026-07-29) and are NOT asserted to be misplaced — triaging which should
 * move into the zone is import-churn refactoring that needs its own PR and
 * smoke pass. The list is asserted to be *exact* in both directions: a new
 * unlisted function fails, and a stale entry that no longer exists also fails,
 * so the list cannot quietly rot into a rubber stamp.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const repoRoot = process.cwd();
const ZONE = "src/resolvers/";

/**
 * Decision functions that live outside the resolver zone, catalogued when the
 * guard shipped. Key is `<path>::<name>`.
 *
 * To add an entry you must state why the function does not belong in the zone
 * (or that it is pending triage). To remove one, move the function into
 * `src/resolvers/` — the stale-entry assertion below will then require the
 * removal, keeping this list honest.
 */
const GRANDFATHERED: Record<string, string> = {
	// A2UI surface + action derivations, co-located with the a2ui service.
	"src/services/a2ui/action.ts::deriveA2uiActionMessageView":
		"pending triage — catalogued 2026-07-29",
	"src/services/a2ui/surface-state.ts::deriveLatestSurfaceId":
		"pending triage — catalogued 2026-07-29",
	"src/services/a2ui/surface-state.ts::deriveSurfaceActionAffordance":
		"pending triage — catalogued 2026-07-29",
	"src/services/a2ui/surface-state.ts::deriveSurfaceAnswers":
		"pending triage — catalogued 2026-07-29",
	"src/services/a2ui/surface-state.ts::deriveSurfaceDefinitions":
		"pending triage — catalogued 2026-07-29",
	// Queue-orchestration decisions, co-located with the queue reducer.
	"src/services/message-queue-logic.ts::decideComposerEnterAction":
		"pending triage — catalogued 2026-07-29",
	"src/services/message-queue-logic.ts::decideConnectFlush":
		"pending triage — catalogued 2026-07-29",
	"src/services/message-queue-logic.ts::decideQueuedSendKind":
		"pending triage — catalogued 2026-07-29",
	// Quick-prompt label / action derivations.
	"src/services/quick-prompts-logic.ts::decideQuickPromptAction":
		"pending triage — catalogued 2026-07-29",
	"src/services/quick-prompts-logic.ts::deriveFilenameBase":
		"pending triage — catalogued 2026-07-29",
	"src/services/quick-prompts-logic.ts::deriveLabel":
		"pending triage — catalogued 2026-07-29",
	"src/services/quick-prompts-logic.ts::deriveLabelFromComposer":
		"pending triage — catalogued 2026-07-29",
	// Session-metadata title derivations, used by the SessionStore writer.
	"src/services/session-metadata.ts::deriveSessionRecordTitle":
		"pending triage — catalogued 2026-07-29",
	"src/services/session-metadata.ts::deriveSessionTitle":
		"pending triage — catalogued 2026-07-29",
	// Utils-resident decisions.
	"src/utils/activeNoteGrabToggle.ts::decideGrabToggle":
		"pending triage — catalogued 2026-07-29",
	"src/utils/link-leaf.ts::deriveNewLeaf":
		"pending triage — catalogued 2026-07-29",
	"src/utils/mcp-auth-affordance.ts::decideMcpAuthAffordance":
		"pending triage — catalogued 2026-07-29",
	"src/utils/settings-layout.ts::deriveImportPlacement":
		"pending triage — catalogued 2026-07-29",
	"src/utils/textarea-autosize.ts::decideTextareaResize":
		"pending triage — catalogued 2026-07-29",
	"src/utils/working-directory.ts::deriveCwdBanner":
		"pending triage — catalogued 2026-07-29",
};

/** `export function derive…` / `export const decide… =` at any indent. */
const DECL = /^export\s+(?:async\s+)?(?:function|const)\s+((?:derive|decide)[A-Z]\w*)/gm;

interface Found {
	key: string;
	file: string;
	name: string;
	inZone: boolean;
}

function scan(): Found[] {
	// --cached --others --exclude-standard: tracked files PLUS untracked-but-not-
	// ignored ones. Tracked-only would give a false green locally — a brand-new
	// file is untracked until `git add`, so the author would see the guard pass
	// and only get caught in CI after the commit.
	const tracked = execSync(
		"git ls-files --cached --others --exclude-standard 'src/**/*.ts' 'src/**/*.tsx'",
		{
			cwd: repoRoot,
			encoding: "utf8",
		},
	)
		.split("\n")
		.filter(Boolean)
		.filter((f) => !f.includes("__tests__") && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

	const out: Found[] = [];
	for (const file of tracked) {
		const src = readFileSync(resolve(repoRoot, file), "utf8");
		for (const m of src.matchAll(DECL)) {
			const name = m[1];
			out.push({ key: `${file}::${name}`, file, name, inZone: file.startsWith(ZONE) });
		}
	}
	return out;
}

const found = scan();

describe("resolver zone", () => {
	// Self-test: a regex that silently matched nothing would make every other
	// assertion here pass trivially. Assert the scanner actually sees the zone.
	it("the scanner finds the resolvers that are already in the zone", () => {
		const inZone = found.filter((f) => f.inZone).map((f) => f.name);
		expect(inZone.length).toBeGreaterThanOrEqual(10);
		expect(inZone).toContain("deriveSendAffordance");
		expect(inZone).toContain("decideAgentSwitch");
	});

	it("every derive*/decide* outside src/resolvers/ is grandfathered with a reason", () => {
		const unlisted = found
			.filter((f) => !f.inZone && !(f.key in GRANDFATHERED))
			.map((f) => f.key)
			.sort();

		expect(
			unlisted,
			[
				"New decision function(s) found outside src/resolvers/.",
				"",
				"A derive*/decide* function is a decision point, and the resolver zone is",
				"where the purity + strict-exhaustiveness lint guards apply. Either:",
				"",
				"  1. move it into src/resolvers/ (preferred), or",
				"  2. add it to GRANDFATHERED in this file with a reason it does not belong there.",
				"",
				`Unlisted: ${unlisted.join(", ")}`,
			].join("\n"),
		).toEqual([]);
	});

	it("no grandfathered entry is stale", () => {
		const present = new Set(found.map((f) => f.key));
		const stale = Object.keys(GRANDFATHERED)
			.filter((k) => !present.has(k))
			.sort();

		expect(
			stale,
			[
				"Grandfathered entr(ies) no longer exist (moved, renamed, or deleted).",
				"Remove them from GRANDFATHERED so the list keeps reflecting reality.",
				"",
				`Stale: ${stale.join(", ")}`,
			].join("\n"),
		).toEqual([]);
	});

	it("a grandfathered entry that moved into the zone is reported as stale", () => {
		// Guards the guard: the stale check keys on the full path, so relocating a
		// function into src/resolvers/ must invalidate its old entry rather than
		// leaving a permanent free pass behind.
		const relocated = "src/resolvers/session-metadata.ts::deriveSessionTitle";
		expect(Object.keys(GRANDFATHERED)).not.toContain(relocated);
	});
});
