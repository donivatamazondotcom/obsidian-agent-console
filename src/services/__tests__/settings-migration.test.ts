import { describe, it, expect } from "vitest";
import { migrateContextNoteSettings } from "../settings-migration";

const D = { activeNoteAsDefaultContext: true, migrationNoticeShown: false };

describe("migrateContextNoteSettings (Decision #20)", () => {
	it("migrates the legacy autoMentionActiveNote key", () => {
		const r = migrateContextNoteSettings({ autoMentionActiveNote: false }, D);
		expect(r.activeNoteAsDefaultContext).toBe(false);
		expect(r.shouldShowNotice).toBe(true);
	});

	it("new key wins over the legacy key", () => {
		const r = migrateContextNoteSettings(
			{ autoMentionActiveNote: true, activeNoteAsDefaultContext: false },
			D,
		);
		expect(r.activeNoteAsDefaultContext).toBe(false);
	});

	it("falls back to default when neither key is present", () => {
		const r = migrateContextNoteSettings({}, D);
		expect(r.activeNoteAsDefaultContext).toBe(true);
		expect(r.shouldShowNotice).toBe(false);
	});

	it("is idempotent — re-running on migrated data is a no-op and shows no notice", () => {
		const first = migrateContextNoteSettings({ autoMentionActiveNote: false }, D);
		// Simulate persisted post-migration state: legacy key gone, notice flag set.
		const migrated = {
			activeNoteAsDefaultContext: first.activeNoteAsDefaultContext,
			migrationNoticeShown: true,
		};
		const second = migrateContextNoteSettings(migrated, D);
		expect(second.activeNoteAsDefaultContext).toBe(false);
		expect(second.shouldShowNotice).toBe(false);
	});

	it("does not re-show the notice if it was already shown, even with legacy key present", () => {
		const r = migrateContextNoteSettings(
			{ autoMentionActiveNote: false, migrationNoticeShown: true },
			D,
		);
		expect(r.shouldShowNotice).toBe(false);
	});
});
