/**
 * Tests for the tools/ CLI logging helpers (I181).
 *
 * The contract these guard is *output equivalence with `console`*: the helpers
 * exist only to avoid the bare `console.*` globals that the Obsidian store's
 * repo-wide scan flags, so any drift in what they emit is a regression in CLI
 * output — the thing the migration promised not to change.
 *
 * Spec: [[Agent Console Review-Bot Parity Gate]] (I181).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { log, logError } from "../cli-log";

/** Capture everything written to a process stream during `fn`. */
function captureStream(
	stream: "stdout" | "stderr",
	fn: () => void,
): string {
	let out = "";
	const spy = vi
		.spyOn(process[stream], "write")
		.mockImplementation((chunk: string | Uint8Array) => {
			out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		});
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return out;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("log", () => {
	it("writes a single trailing newline to stdout", () => {
		expect(captureStream("stdout", () => log("hello"))).toBe("hello\n");
	});

	it("emits a bare newline for an empty string, as console.log does", () => {
		expect(captureStream("stdout", () => log(""))).toBe("\n");
	});

	it("emits a bare newline when called with no arguments", () => {
		expect(captureStream("stdout", () => log())).toBe("\n");
	});

	it("preserves embedded newlines rather than escaping them", () => {
		expect(captureStream("stdout", () => log("## Heading\n"))).toBe(
			"## Heading\n\n",
		);
	});

	it("space-joins multiple arguments like console.log", () => {
		expect(captureStream("stdout", () => log("a", "b", "c"))).toBe("a b c\n");
	});

	it("applies util.format substitution like console.log", () => {
		expect(captureStream("stdout", () => log("%s=%d", "n", 42))).toBe(
			"n=42\n",
		);
	});

	it("does not write to stderr", () => {
		expect(captureStream("stderr", () => log("to stdout only"))).toBe("");
	});
});

describe("logError", () => {
	it("writes to stderr with a trailing newline", () => {
		expect(captureStream("stderr", () => logError("boom"))).toBe("boom\n");
	});

	it("renders an Error's stack, as console.error does", () => {
		const err = new Error("kaboom");
		const out = captureStream("stderr", () => logError(err));
		expect(out).toContain("Error: kaboom");
		// The stack — not just the message — is what console.error prints; the
		// screenshot/invariant runners rely on it for diagnosis.
		expect(out).toContain("cli-log.test");
		expect(out.endsWith("\n")).toBe(true);
	});

	it("does not write to stdout", () => {
		expect(captureStream("stdout", () => logError("to stderr only"))).toBe("");
	});
});
