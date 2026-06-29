/**
 * Unit tests for QuickPromptLibrary (scan / watch / reconcile).
 *
 * Covers T05 from [[Agent Console Quick Prompts and Workflows]] § Test Cases —
 * a folder change updates the in-memory library without a restart. The library
 * is exercised through a fake `QuickPromptSource`, so no Obsidian harness is
 * needed (the real `VaultQuickPromptSource` wiring is covered by the human
 * smoke test).
 */
import { describe, it, expect, vi } from "vitest";
import { QuickPromptLibrary, type QuickPromptSource } from "../quick-prompts";
import type { QuickPromptFileInput } from "../../types/quick-prompt";

function file(basename: string, body = "body"): QuickPromptFileInput {
	return {
		path: `Quick Prompts/${basename}.md`,
		basename,
		frontmatter: { label: basename },
		body,
	};
}

/** A controllable fake source whose file set and change emitter the test drives. */
function makeFakeSource(initial: QuickPromptFileInput[]) {
	let files = initial;
	let changeCb: (() => void) | null = null;
	const source: QuickPromptSource = {
		load: vi.fn(async () => files),
		onChange: (cb) => {
			changeCb = cb;
			return () => {
				changeCb = null;
			};
		},
	};
	return {
		source,
		setFiles: (next: QuickPromptFileInput[]) => {
			files = next;
		},
		emitChange: () => changeCb?.(),
		hasSubscriber: () => changeCb != null,
	};
}

describe("QuickPromptLibrary — T05: watch reconciles without restart", () => {
	it("loads the initial folder contents on init", async () => {
		const fake = makeFakeSource([file("Debrief"), file("Sync opps")]);
		const lib = new QuickPromptLibrary(fake.source);
		await lib.init();

		const prompts = lib.getPrompts();
		expect(prompts.map((p) => p.label)).toEqual(["Debrief", "Sync opps"]);
		expect(prompts.map((p) => p.id)).toEqual(["debrief", "sync-opps"]);
	});

	it("re-scans and updates the library when a change fires (add / remove / re-parse)", async () => {
		const fake = makeFakeSource([file("Debrief")]);
		const lib = new QuickPromptLibrary(fake.source);
		await lib.init();
		expect(lib.getPrompts().map((p) => p.label)).toEqual(["Debrief"]);

		// Add a file + re-parse an existing one (new label).
		fake.setFiles([
			file("Debrief meeting"),
			file("Get latest"),
		]);
		fake.emitChange();
		await flush();

		expect(lib.getPrompts().map((p) => p.label)).toEqual([
			"Debrief meeting",
			"Get latest",
		]);

		// Remove all.
		fake.setFiles([]);
		fake.emitChange();
		await flush();
		expect(lib.getPrompts()).toEqual([]);
	});

	it("notifies subscribers on each reconcile", async () => {
		const fake = makeFakeSource([file("A")]);
		const lib = new QuickPromptLibrary(fake.source);
		const listener = vi.fn();
		lib.subscribe(listener);
		await lib.init();
		expect(listener).toHaveBeenCalledTimes(1); // initial scan

		fake.setFiles([file("A"), file("B")]);
		fake.emitChange();
		await flush();
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("stops watching and clears listeners on destroy", async () => {
		const fake = makeFakeSource([file("A")]);
		const lib = new QuickPromptLibrary(fake.source);
		await lib.init();
		expect(fake.hasSubscriber()).toBe(true);

		lib.destroy();
		expect(fake.hasSubscriber()).toBe(false);

		const listener = vi.fn();
		lib.subscribe(listener);
		lib.destroy();
		fake.emitChange();
		await flush();
		expect(listener).not.toHaveBeenCalled();
	});
});

/** Let pending microtasks (the async refresh) settle. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
