/**
 * Confirmed model vs the composer's pick (Session Title in the Chat Header,
 * Test 4).
 *
 * The header hides the model when the composer shows a model picker, except
 * when the agent reported running a different model than the one picked
 * (Header Branding decision #8: the header confirms what actually ran).
 * `deriveConfirmedModelDiffers` answers that, reusing the I258 staleness rule.
 * `deriveHeaderModelName` names a confirmed id by its option's display name
 * when one matches, instead of showing the raw id.
 */
import { describe, expect, it } from "vitest";

import {
	deriveConfirmedModelDiffers,
	deriveHeaderModelName,
} from "../header-agent";
import type { SessionConfigOption } from "../../types/session";

const modelOption = (currentValue: string): SessionConfigOption => ({
	id: "model",
	name: "Model",
	category: "model",
	type: "select",
	currentValue,
	options: [
		{ value: "opus", name: "Claude Opus 5.5" },
		{ value: "sonnet", name: "Claude Sonnet 5" },
	],
});

const legacy = {
	currentModelId: "a",
	availableModels: [
		{ modelId: "a", name: "Legacy A" },
		{ modelId: "b", name: "Legacy B" },
	],
};

describe("deriveConfirmedModelDiffers", () => {
	it("no confirmation → false", () => {
		expect(deriveConfirmedModelDiffers({ configOptions: [modelOption("opus")] })).toBe(
			false,
		);
	});

	it("the agent confirmed the model that was picked → false", () => {
		expect(
			deriveConfirmedModelDiffers({
				confirmedModelId: "opus",
				confirmedUnder: "opus",
				configOptions: [modelOption("opus")],
			}),
		).toBe(false);
	});

	it("the agent confirmed a different model than the pick it ran under → true", () => {
		expect(
			deriveConfirmedModelDiffers({
				confirmedModelId: "sonnet",
				confirmedUnder: "opus",
				configOptions: [modelOption("opus")],
			}),
		).toBe(true);
	});

	it("I258: a confirmation from an older pick is stale → false", () => {
		expect(
			deriveConfirmedModelDiffers({
				confirmedModelId: "sonnet",
				confirmedUnder: "older-pick",
				configOptions: [modelOption("opus")],
			}),
		).toBe(false);
	});

	it("legacy models: compares against the legacy selection", () => {
		expect(
			deriveConfirmedModelDiffers({
				confirmedModelId: "b",
				confirmedUnder: "a",
				models: legacy,
			}),
		).toBe(true);
		expect(
			deriveConfirmedModelDiffers({
				confirmedModelId: "b",
				confirmedUnder: "older-pick",
				models: legacy,
			}),
		).toBe(false);
	});
});

describe("deriveHeaderModelName names a confirmed id", () => {
	it("by the matching config option's display name", () => {
		expect(
			deriveHeaderModelName({
				confirmedModelId: "sonnet",
				confirmedUnder: "opus",
				configOptions: [modelOption("opus")],
			}),
		).toBe("Claude Sonnet 5");
	});

	it("by the matching legacy model's name", () => {
		expect(
			deriveHeaderModelName({
				confirmedModelId: "b",
				confirmedUnder: "a",
				models: legacy,
			}),
		).toBe("Legacy B");
	});

	it("as the raw id when no option matches", () => {
		expect(
			deriveHeaderModelName({
				confirmedModelId: "x-confirmed",
				confirmedUnder: "opus",
				configOptions: [modelOption("opus")],
			}),
		).toBe("x-confirmed");
	});
});
