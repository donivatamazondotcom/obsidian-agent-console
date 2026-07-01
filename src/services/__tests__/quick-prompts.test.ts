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
import {
	QuickPromptLibrary,
	createQuickPrompt,
	type QuickPromptSource,
	type QuickPromptWriter,
} from "../quick-prompts";
import { NEW_PROMPT_BODY_PLACEHOLDER } from "../quick-prompts-logic";
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

// ============================================================================
// QP-I26 — scan/cache race: a metadataCache "changed" event that fires while
// the initial scan is in flight must not be dropped.
//
// Cold start: the first scan reads a file whose frontmatter is not yet cached,
// so `getFileCache(file)?.frontmatter` is null and the entry falls back to the
// filename label (and loses `open in new tab`). When the frontmatter resolves,
// a metadataCache "changed" event fires. If the library subscribes only AFTER
// the initial load completes, that event is dropped and the filename-fallback
// entry sticks until a manual rescan. The library must subscribe BEFORE the
// initial scan so the reconcile is caught (refreshSeq makes it win over the
// stale scan). See [[Agent Console Quick Prompts and Workflows]] § QP-I26.
// ============================================================================
describe("QuickPromptLibrary — QP-I26: reconciles a change during the initial scan", () => {
	it("catches a metadata 'changed' event fired while the first scan is in flight", async () => {
		let loadCall = 0;
		let releaseFirstLoad!: () => void;
		const firstLoadGate = new Promise<void>((resolve) => {
			releaseFirstLoad = resolve;
		});

		// First scan sees an un-cached file → filename fallback, no newTab.
		const stale: QuickPromptFileInput = {
			path: "Quick Prompts/Translate to French.md",
			basename: "Translate to French",
			frontmatter: null,
			body: "body",
		};
		// The frontmatter resolves before the reconcile scan reads it.
		const resolved: QuickPromptFileInput = {
			path: "Quick Prompts/Translate to French.md",
			basename: "Translate to French",
			frontmatter: {
				label: "🇫🇷 Translate to French",
				"open in new tab": true,
			},
			body: "body",
		};

		let changeCb: (() => void) | null = null;
		const source: QuickPromptSource = {
			load: vi.fn(async () => {
				loadCall += 1;
				if (loadCall === 1) {
					await firstLoadGate; // hold the initial scan open
					return [stale];
				}
				return [resolved];
			}),
			onChange: (cb) => {
				changeCb = cb;
				return () => {
					changeCb = null;
				};
			},
		};
		// Closures keep the optional call inside a function body so TS uses the
		// declared type (a direct `changeCb?.()` in linear flow narrows to null).
		const hasSubscriber = () => changeCb != null;
		const emitChange = () => changeCb?.();

		const lib = new QuickPromptLibrary(source);
		const initPromise = lib.init();
		await flush(); // let init reach its first await (the load gate)

		// The frontmatter resolves NOW, while the initial scan is still in
		// flight. A robust library is already subscribed, so this reconciles.
		expect(hasSubscriber()).toBe(true); // subscribe-before-scan invariant
		emitChange();

		releaseFirstLoad(); // initial (stale) scan completes
		await initPromise;
		await flush(); // let the reconcile scan settle

		const prompts = lib.getPrompts();
		expect(prompts).toHaveLength(1);
		expect(prompts[0].label).toBe("🇫🇷 Translate to French");
		expect(prompts[0].newTab).toBe(true);
	});
});

// ============================================================================
// S4-T7/T8 — Slice 4: createQuickPrompt (clobber-safe write orchestration)
//
// Derives a filesystem-safe basename from the label, disambiguates against the
// folder's existing notes (never overwrites), builds the templated note, and
// writes via the injected QuickPromptWriter port. The real adapter wraps
// Vault.create + FileManager.processFrontMatter; the open + composer-intact
// behaviors are human-smoke (S4-T10..T12). See [[Agent Console Quick Prompts
// UX Refinement]] § Creating quick prompts (D4).
// ============================================================================
describe("createQuickPrompt — S4-T7/T8 (clobber-safe creation)", () => {
	/** A fake writer backed by an in-memory basename → {body, frontmatter} map. */
	function makeFakeWriter(
		initial: Record<
			string,
			{ body: string; frontmatter: Record<string, unknown> }
		> = {},
	) {
		const store = new Map(Object.entries(initial));
		const writer: QuickPromptWriter = {
			listBasenames: () => [...store.keys()],
			create: vi.fn(async (basename, body, frontmatter) => {
				if (store.has(basename)) {
					throw new Error(`File already exists: ${basename}`);
				}
				store.set(basename, { body, frontmatter });
				return `Quick Prompts/${basename}.md`;
			}),
			setLabel: vi.fn(async () => undefined),
		};
		return { writer, store };
	}

	it("S4-T7: writes a templated note via the writer and returns its path", async () => {
		const { writer, store } = makeFakeWriter();
		const result = await createQuickPrompt(writer, {
			label: "Daily brief",
			body: "Give me the latest on X.",
		});
		expect(result).toEqual({
			path: "Quick Prompts/Daily brief.md",
			basename: "Daily brief",
			collided: false,
		});
		expect(writer.create).toHaveBeenCalledWith(
			"Daily brief",
			"Give me the latest on X.",
			{
				label: "Daily brief",
				"open in new tab": false,
				"always show": false,
				"show when": [],
			},
		);
		expect(store.get("Daily brief")?.body).toBe("Give me the latest on X.");
	});

	it("S4-T7: no body → placeholder body (create-on-no-match path)", async () => {
		const { writer, store } = makeFakeWriter();
		await createQuickPrompt(writer, { label: "daily" });
		expect(store.get("daily")?.body).toBe(NEW_PROMPT_BODY_PLACEHOLDER);
	});

	it("QP-I08: blank label → 'New prompt' note (prefilled, never empty)", async () => {
		const { writer, store } = makeFakeWriter();
		const r = await createQuickPrompt(writer, { label: "" });
		expect(r.basename).toBe("New prompt");
		expect(store.get("New prompt")?.frontmatter.label).toBe("New prompt");
	});

	it("S4-T8: collision → disambiguates, never overwrites the existing note", async () => {
		const { writer, store } = makeFakeWriter({
			"Daily brief": {
				body: "ORIGINAL",
				frontmatter: { label: "Daily brief" },
			},
		});
		const result = await createQuickPrompt(writer, {
			label: "Daily brief",
			body: "NEW",
		});
		// New note got a disambiguated name…
		expect(result.basename).toBe("Daily brief 1");
		expect(result.collided).toBe(true);
		// …and the original is untouched.
		expect(store.get("Daily brief")?.body).toBe("ORIGINAL");
		expect(store.get("Daily brief 1")?.body).toBe("NEW");
		// create was never called with the existing basename.
		expect(writer.create).not.toHaveBeenCalledWith(
			"Daily brief",
			expect.anything(),
			expect.anything(),
		);
	});
});
