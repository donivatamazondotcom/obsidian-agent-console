import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { buildContextBlocks } from "../context-builder";
import { buildFileUri } from "../../utils/paths";
import { convertWindowsPathToWsl } from "../../utils/platform";
import type { PromptContent } from "../../types/chat";

/**
 * I378: buildContextBlocks memoizes its links per vault root and WSL mode.
 * The links the agent receives must not change, on the first send or on a
 * repeat send that reads the memo, or after the vault root or WSL mode
 * changes. The oracle is the per-note composition #394 (I324) shipped:
 * vault root + "/" + note path, through convertWindowsPathToWsl in WSL mode,
 * then the shared buildFileUri. Concrete Unix, Windows and WSL strings stay
 * pinned by i324-note-links-agent-receives; this test checks the same
 * equality over generated vault roots and note paths, including backslashes,
 * drive letters and newlines.
 */
function oracle(vaultPath: string, notePath: string, wsl: boolean): string {
	let abs = vaultPath ? `${vaultPath}/${notePath}` : notePath;
	if (wsl) abs = convertWindowsPathToWsl(abs);
	return buildFileUri(abs);
}

/** Every link in the blocks, in order: resource URIs, link URIs, text refs. */
function linksIn(blocks: PromptContent[]): string[] {
	const out: string[] = [];
	for (const b of blocks) {
		if (b.type === "resource") out.push(b.resource.uri);
		else if (b.type === "resource_link") out.push(b.uri);
		else if (b.type === "text") {
			const m = /^<obsidian_(?:context_note|selection) ref="([^"]*)"/.exec(b.text);
			if (m) out.push(m[1]);
		}
	}
	return out;
}

const segment = fc.stringMatching(/^[A-Za-z0-9 ._:\\\n-]{0,12}$/);
const vaultArb = fc.oneof(
	fc.constant(""),
	fc.constant("/Users/example/vault"),
	fc.constant("C:\\Users\\example\\vault"),
	fc.constant("D:/work/vault"),
	fc.constant("C:"),
	fc.array(segment, { maxLength: 4 }).map((s) => s.join("/")),
	fc.array(segment, { maxLength: 4 }).map((s) => s.join("\\")),
);
const noteArb = fc.oneof(
	fc.array(segment, { minLength: 1, maxLength: 4 }).map((s) => `${s.join("/")}.md`),
	segment,
);

describe("I378 – context links are unchanged by the per-call link builder", () => {
	it("every pinned-note and selection link equals the per-note composition", () => {
		fc.assert(
			fc.property(
				vaultArb,
				fc.array(noteArb, { minLength: 1, maxLength: 4 }),
				noteArb,
				fc.boolean(),
				fc.boolean(),
				fc.boolean(),
				(vaultPath, notePaths, selPath, wsl, embedded, hydrateFirst) => {
					const hydrationBodies = hydrateFirst
						? new Map([[notePaths[0], "body"]])
						: undefined;
					const send = (convertToWsl: boolean) =>
						linksIn(
							buildContextBlocks({
								contextNotes: notePaths.map((path) => ({
									path,
									source: "user" as const,
									seen: true,
								})),
								selection: { path: selPath, fromLine: 1, toLine: 2, text: "x" },
								useEmbeddedContext: embedded,
								vaultPath,
								convertToWsl,
								hydrationBodies,
							}),
						);
					const expectedFor = (convertToWsl: boolean) => {
						const expected: string[] = [];
						for (const p of notePaths) {
							const ref = oracle(vaultPath, p, convertToWsl);
							expected.push(ref);
							// An embedded hydrated note sends its body resource and its link.
							if (embedded && hydrationBodies?.has(p)) expected.push(ref);
						}
						expected.push(oracle(vaultPath, selPath, convertToWsl));
						return expected;
					};
					// First send, repeat send (memo hits), then the other WSL mode.
					expect(send(wsl)).toEqual(expectedFor(wsl));
					expect(send(wsl)).toEqual(expectedFor(wsl));
					expect(send(!wsl)).toEqual(expectedFor(!wsl));
				},
			),
			{ numRuns: 2000 },
		);
	});
});
