/**
 * I306: the settings-import offer is for brand-new installs only.
 *
 * `mayOfferSettingsImport` is the gate that runs BEFORE source detection, so
 * an existing install never pays for reading another plugin's data.json.
 * Detection then decides whether the offer actually shows.
 */
import { describe, it, expect } from "vitest";
import { mayOfferSettingsImport } from "../settings-import-offer";

describe("I306 mayOfferSettingsImport", () => {
	it("an existing install with the flag unset is never offered (the reported bug)", () => {
		expect(
			mayOfferSettingsImport({ isFreshInstall: false, offerShown: false }),
		).toBe(false);
	});

	it("a fresh install that hasn't seen the offer may be offered", () => {
		expect(
			mayOfferSettingsImport({ isFreshInstall: true, offerShown: false }),
		).toBe(true);
	});

	it("a fresh install that already saw the offer isn't offered again", () => {
		expect(
			mayOfferSettingsImport({ isFreshInstall: true, offerShown: true }),
		).toBe(false);
	});

	it("an existing install that already saw the offer isn't offered", () => {
		expect(
			mayOfferSettingsImport({ isFreshInstall: false, offerShown: true }),
		).toBe(false);
	});
});
