/**
 * `mayOfferSettingsImport` — the gate in front of the first-run offer to
 * import settings from another agent plugin.
 *
 * WHY THIS EXISTS (I306)
 * The offer used to check only the one-shot `settingsImportOfferShown` flag.
 * That flag shipped in v1.2.0, so every install older than it read as "never
 * offered" and got the toast on its first launch after upgrading, even though
 * it was already set up. Offering an import to a configured user is wrong.
 *
 * DESIGN
 * The offer is for a brand-new install only (`loadSettings` found no
 * data.json). The one-shot flag stays as the guard against a second offer on
 * that fresh install. This gate runs BEFORE source detection, so an existing
 * install never reads or parses another plugin's data.json.
 */
export function mayOfferSettingsImport(input: {
	isFreshInstall: boolean;
	offerShown: boolean;
}): boolean {
	return input.isFreshInstall && !input.offerShown;
}
