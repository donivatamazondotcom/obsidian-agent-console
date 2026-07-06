import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VIEW_TYPE_CHAT } from "../ui/chat-view-type";
import { LEGACY_CHAT_VIEW_TYPE } from "../services/migrate-legacy-view-type";

// I157 regression guard: Obsidian sets `data-type` on the leaf to the view's
// type, so any CSS scoped via `[data-type="…"]` must track VIEW_TYPE_CHAT. The
// 2.0.1 rename orphaned `[data-type="agent-client-chat-view"] > .view-content`
// (the padding reset), which left the theme's default padding showing as an
// unexpected margin around the chat controls. This locks the selector to the
// current view type so a future rename can't silently re-orphan it.
describe("I157 — styles.css view-type selectors track the current view type", () => {
	const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

	it("has no data-type selector referencing the legacy view type", () => {
		expect(css).not.toContain(`data-type="${LEGACY_CHAT_VIEW_TYPE}"`);
	});

	it("scopes the view via the current view type", () => {
		expect(css).toContain(`data-type="${VIEW_TYPE_CHAT}"`);
	});
});
