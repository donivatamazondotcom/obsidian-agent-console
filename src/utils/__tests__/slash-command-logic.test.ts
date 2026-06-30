/**
 * slash-command-logic — trigger detection + filtering for the `/` picker.
 * Pins slash-only-at-start, space-terminates, and case-insensitive filtering.
 * Spec: [[Unified Picker Control]] (Tier 3).
 */
import { describe, it, expect } from "vitest";
import {
	detectSlashTrigger,
	filterSlashCommands,
} from "../slash-command-logic";
import type { SlashCommand } from "../../types/session";

const cmd = (name: string, description = `${name} command`): SlashCommand => ({
	name,
	description,
});

describe("detectSlashTrigger", () => {
	it("returns null when the input does not start with /", () => {
		expect(detectSlashTrigger("", 0)).toBeNull();
		expect(detectSlashTrigger("hello", 5)).toBeNull();
		expect(detectSlashTrigger(" /help", 6)).toBeNull(); // leading space
		expect(detectSlashTrigger("a/b", 3)).toBeNull(); // mid-string slash
	});

	it("triggers a bare / with an empty query (show all)", () => {
		expect(detectSlashTrigger("/", 1)).toEqual({ start: 0, query: "" });
	});

	it("captures the query after / up to the caret", () => {
		expect(detectSlashTrigger("/he", 3)).toEqual({ start: 0, query: "he" });
		// Caret mid-token — only up to the caret.
		expect(detectSlashTrigger("/help", 2)).toEqual({ start: 0, query: "h" });
	});

	it("lowercases the query (case-insensitive matching)", () => {
		expect(detectSlashTrigger("/Help", 5)).toEqual({
			start: 0,
			query: "help",
		});
	});

	it("deactivates once a space follows (command complete, typing args)", () => {
		expect(detectSlashTrigger("/help ", 6)).toBeNull();
		expect(detectSlashTrigger("/help arg", 9)).toBeNull();
		// Space before the caret deactivates even if caret is at the space.
		expect(detectSlashTrigger("/a b", 4)).toBeNull();
	});

	it("always reports start 0 (slash only triggers at input start)", () => {
		expect(detectSlashTrigger("/x", 2)?.start).toBe(0);
	});
});

describe("filterSlashCommands", () => {
	const commands = [cmd("help"), cmd("clear"), cmd("compact"), cmd("model")];

	it("returns all commands for an empty query", () => {
		expect(filterSlashCommands(commands, "").map((c) => c.name)).toEqual([
			"help",
			"clear",
			"compact",
			"model",
		]);
	});

	it("substring-matches the command name", () => {
		expect(filterSlashCommands(commands, "c").map((c) => c.name)).toEqual([
			"clear",
			"compact",
		]);
		expect(
			filterSlashCommands(commands, "model").map((c) => c.name),
		).toEqual(["model"]);
	});

	it("is case-insensitive", () => {
		expect(
			filterSlashCommands(commands, "HELP").map((c) => c.name),
		).toEqual(["help"]);
	});

	it("returns [] when nothing matches", () => {
		expect(filterSlashCommands(commands, "zzz")).toEqual([]);
	});
});
