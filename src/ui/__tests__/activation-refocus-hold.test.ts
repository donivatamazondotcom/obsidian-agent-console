/**
 * One-shot activation-refocus hold (I301 code review B1, R1).
 * The rail sets it before a keyboard close of the active key; the next
 * activation refocus in that document consumes it. A hold nobody consumes
 * (for example the neighbor tab crashed and has no composer) must not skip a
 * later, unrelated refocus, and a hold in one window never touches another.
 */
import { describe, it, expect } from "vitest";
import {
	holdNextActivationRefocus,
	takeActivationRefocusHold,
} from "../composer-focus";

const wait = (ms: number) =>
	new Promise<void>((resolve) => window.setTimeout(resolve, ms));

describe("activation refocus hold", () => {
	it("is consumed once by the next refocus in the same tick chain", () => {
		holdNextActivationRefocus(document);
		expect(takeActivationRefocusHold(document)).toBe(true);
		expect(takeActivationRefocusHold(document)).toBe(false);
	});

	it("a refocus scheduled in the same commit (setTimeout 0) still finds it", async () => {
		holdNextActivationRefocus(document);
		const seen = await new Promise<boolean>((r) =>
			window.setTimeout(() => r(takeActivationRefocusHold(document)), 0),
		);
		expect(seen).toBe(true);
	});

	it("an unconsumed hold expires, so a later refocus is not skipped", async () => {
		holdNextActivationRefocus(document);
		await wait(150);
		expect(takeActivationRefocusHold(document)).toBe(false);
	});

	it("a hold in one document doesn't affect another (popouts)", () => {
		const other = document.implementation.createHTMLDocument("popout");
		holdNextActivationRefocus(other);
		expect(takeActivationRefocusHold(document)).toBe(false);
		expect(takeActivationRefocusHold(other)).toBe(true);
	});

	it("a second hold isn't cleared early by the first one's expiry", async () => {
		holdNextActivationRefocus(document);
		await wait(60);
		holdNextActivationRefocus(document);
		// The first hold's expiry fires here; the second must survive it.
		await wait(60);
		expect(takeActivationRefocusHold(document)).toBe(true);
	});
});
