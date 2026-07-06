import { describe, it, expect, vi } from "vitest";
import { VIEW_TYPE_CHAT } from "../../ui/chat-view-type";
import {
	LEGACY_CHAT_VIEW_TYPE,
	migrateLegacyChatViewType,
	type MigratableWorkspace,
	type MigratableLeaf,
} from "../migrate-legacy-view-type";

type MockLeaf = MigratableLeaf & { setViewState: ReturnType<typeof vi.fn> };

function makeLeaf(
	type: string | undefined,
	extra: Record<string, unknown> = {},
): MockLeaf {
	return {
		getViewState: () => ({ type, ...extra }),
		setViewState: vi.fn(),
	};
}

function makeWorkspace(leaves: MigratableLeaf[]): MigratableWorkspace {
	return {
		iterateAllLeaves: (cb) => leaves.forEach(cb),
	};
}

describe("I157 — view-type collision fix", () => {
	it("uses a namespaced view type that cannot collide with upstream Agent Client", () => {
		// The crash was: both plugins registered "agent-client-chat-view".
		// The fix namespaces ours so registerView can't collide when both are enabled.
		expect(VIEW_TYPE_CHAT).toBe("agent-console-chat-view");
		expect(LEGACY_CHAT_VIEW_TYPE).toBe("agent-client-chat-view");
		expect(VIEW_TYPE_CHAT).not.toBe(LEGACY_CHAT_VIEW_TYPE);
	});

	it("migrates a restored legacy-type leaf to the new type, preserving state + active", () => {
		const legacy = makeLeaf(LEGACY_CHAT_VIEW_TYPE, {
			state: { foo: 1 },
			active: true,
		});
		const migrated = migrateLegacyChatViewType(makeWorkspace([legacy]));
		expect(migrated).toBe(1);
		// leaf.id is preserved across setViewState (same leaf), so the
		// leaf-id-keyed tab/session slice (I47) re-associates on remount.
		expect(legacy.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_CHAT,
			state: { foo: 1 },
			active: true,
		});
	});

	it("leaves non-legacy and already-migrated leaves untouched (idempotent)", () => {
		const other = makeLeaf("markdown");
		const already = makeLeaf(VIEW_TYPE_CHAT, { state: {} });
		const migrated = migrateLegacyChatViewType(
			makeWorkspace([other, already]),
		);
		expect(migrated).toBe(0);
		expect(other.setViewState).not.toHaveBeenCalled();
		expect(already.setViewState).not.toHaveBeenCalled();
	});
});
