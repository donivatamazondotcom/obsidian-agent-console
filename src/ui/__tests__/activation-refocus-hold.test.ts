/**
 * Activation-refocus hold (I301). The rail sets it before a keyboard close of
 * the active key; both activation refocus paths in InputArea (I19, I26) check
 * it. It is a short window, checked and never consumed, so both paths see it;
 * it expires on its own, so a hold nobody needed (the neighbor crashed and has
 * no composer) never skips a later, unrelated refocus.
 */
import { describe, it, expect } from "vitest";
import {
	holdNextActivationRefocus,
	isActivationRefocusHeld,
} from "../composer-focus";

const wait = (ms: number) =>
	new Promise<void>((resolve) => window.setTimeout(resolve, ms));

describe("activation refocus hold", () => {
	it("holds for both refocus paths: checking doesn't clear it", async () => {
		holdNextActivationRefocus(document);
		expect(isActivationRefocusHeld(document)).toBe(true); // I19, setTimeout 0
		await wait(40);
		expect(isActivationRefocusHeld(document)).toBe(true); // I26, a frame or so later
	});

	it("expires, so a later refocus is not skipped", async () => {
		holdNextActivationRefocus(document);
		await wait(300);
		expect(isActivationRefocusHeld(document)).toBe(false);
	});

	it("a hold in one document doesn't affect another (popouts)", () => {
		const other = document.implementation.createHTMLDocument("popout");
		holdNextActivationRefocus(other);
		expect(isActivationRefocusHeld(document)).toBe(false);
		expect(isActivationRefocusHeld(other)).toBe(true);
	});

	it("a newer hold survives an older one's expiry", async () => {
		await wait(300); // let earlier tests' holds lapse
		holdNextActivationRefocus(document);
		await wait(150);
		holdNextActivationRefocus(document);
		await wait(150); // the first hold's expiry has fired
		expect(isActivationRefocusHeld(document)).toBe(true);
	});
});
