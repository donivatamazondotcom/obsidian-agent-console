/**
 * Pure migration for context-note settings (spec Decision #20):
 * `autoMentionActiveNote` → `activeNoteAsDefaultContext`.
 *
 * New key wins; falls back to the legacy key; then to defaults. Idempotent —
 * re-running on already-migrated raw (no legacy key) is a no-op and never
 * re-shows the one-shot notice. See Atlas "test data migrations" + the Tab
 * Persistence retro § migration round-trip discipline.
 */
const asBool = (v: unknown, d: boolean): boolean =>
	typeof v === "boolean" ? v : d;

export interface ContextNoteSettingsMigration {
	activeNoteAsDefaultContext: boolean;
	migrationNoticeShown: boolean;
	/** Whether the one-shot migration notice should fire on this load. */
	shouldShowNotice: boolean;
}

export function migrateContextNoteSettings(
	raw: Record<string, unknown>,
	defaults: {
		activeNoteAsDefaultContext: boolean;
		migrationNoticeShown: boolean;
	},
): ContextNoteSettingsMigration {
	const activeNoteAsDefaultContext = asBool(
		raw.activeNoteAsDefaultContext,
		asBool(raw.autoMentionActiveNote, defaults.activeNoteAsDefaultContext),
	);
	const migrationNoticeShown = asBool(
		raw.migrationNoticeShown,
		defaults.migrationNoticeShown,
	);
	const shouldShowNotice =
		raw.autoMentionActiveNote !== undefined && !migrationNoticeShown;

	return { activeNoteAsDefaultContext, migrationNoticeShown, shouldShowNotice };
}
