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
		expect(VIEW_TYPE_CHAT).toBe("agent-console-chat-view");
		expect(LEGACY_CHAT_VIEW_TYPE).toBe("agent-client-chat-view");
		expect(VIEW_TYPE_CHAT).not.toBe(LEGACY_CHAT_VIEW_TYPE);
	});

	it("migrates a restored legacy-type leaf to the new type when the legacy type is orphaned (unregistered)", () => {
		const legacy = makeLeaf(LEGACY_CHAT_VIEW_TYPE, {
			state: { foo: 1 },
			active: true,
		});
		const migrated = migrateLegacyChatViewType(makeWorkspace([legacy]), {
			legacyTypeRegistered: false,
		});
		expect(migrated).toBe(1);
		expect(legacy.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_CHAT,
			state: { foo: 1 },
			active: true,
		});
	});

	it("does NOT touch legacy-type leaves when the legacy type is still registered (Agent Client present) — no hijack", () => {
		// An existing Agent Client user installs Agent Console: the
		// agent-client-chat-view leaves are Agent Client's LIVE panels, not our
		// orphaned pre-2.0.1 leaves. Re-homing them would hijack the incumbent.
		const upstreamLeaf = makeLeaf(LEGACY_CHAT_VIEW_TYPE, {
			state: {},
			active: true,
		});
		const migrated = migrateLegacyChatViewType(
			makeWorkspace([upstreamLeaf]),
			{ legacyTypeRegistered: true },
		);
		expect(migrated).toBe(0);
		expect(upstreamLeaf.setViewState).not.toHaveBeenCalled();
	});

	it("leaves non-legacy and already-migrated leaves untouched (idempotent)", () => {
		const other = makeLeaf("markdown");
		const already = makeLeaf(VIEW_TYPE_CHAT, { state: {} });
		const migrated = migrateLegacyChatViewType(
			makeWorkspace([other, already]),
			{ legacyTypeRegistered: false },
		);
		expect(migrated).toBe(0);
		expect(other.setViewState).not.toHaveBeenCalled();
		expect(already.setViewState).not.toHaveBeenCalled();
	});
});
