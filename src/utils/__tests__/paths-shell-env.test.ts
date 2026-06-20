import { describe, it, expect } from "vitest";
import {
	parseShellPathOutput,
	prependPath,
	PATH_PROBE_START,
	PATH_PROBE_END,
} from "../paths";

describe("I-FRO1: parseShellPathOutput", () => {
	it("extracts the PATH between sentinels, ignoring rc chatter", () => {
		const stdout =
			"p10k instant prompt banner\n" +
			`${PATH_PROBE_START}/Users/me/.toolbox/bin:/usr/bin:/bin${PATH_PROBE_END}` +
			"\n[oh-my-zsh] history saved";
		expect(parseShellPathOutput(stdout)).toBe(
			"/Users/me/.toolbox/bin:/usr/bin:/bin",
		);
	});

	it("trims surrounding whitespace inside the sentinels", () => {
		const stdout = `${PATH_PROBE_START}  /usr/bin:/bin \n${PATH_PROBE_END}`;
		expect(parseShellPathOutput(stdout)).toBe("/usr/bin:/bin");
	});

	it("returns null when sentinels are missing", () => {
		expect(parseShellPathOutput("no markers here")).toBeNull();
	});

	it("returns null when the value between sentinels is empty", () => {
		expect(
			parseShellPathOutput(`${PATH_PROBE_START}${PATH_PROBE_END}`),
		).toBeNull();
		expect(
			parseShellPathOutput(`${PATH_PROBE_START}   ${PATH_PROBE_END}`),
		).toBeNull();
	});
});

describe("I-FRO1: prependPath", () => {
	it("prepends shell PATH entries ahead of the existing env PATH", () => {
		const result = prependPath("/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin");
		expect(result).toBe("/opt/homebrew/bin:/usr/bin:/bin");
	});

	it("dedupes entries, keeping the first (shell) occurrence", () => {
		const result = prependPath(
			"/usr/bin:/bin:/opt/homebrew/bin",
			"/opt/homebrew/bin:/usr/bin",
		);
		expect(result).toBe("/opt/homebrew/bin:/usr/bin:/bin");
	});

	it("returns the addition when existing is empty or undefined", () => {
		expect(prependPath(undefined, "/usr/bin:/bin")).toBe("/usr/bin:/bin");
		expect(prependPath("", "/usr/bin:/bin")).toBe("/usr/bin:/bin");
	});

	it("returns existing when the addition is empty", () => {
		expect(prependPath("/usr/bin:/bin", "")).toBe("/usr/bin:/bin");
	});

	it("ignores empty path segments", () => {
		expect(prependPath("/usr/bin::", "/opt/bin:")).toBe(
			"/opt/bin:/usr/bin",
		);
	});
});
