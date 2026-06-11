/**
 * Tests for the animated-GIF encoder (v2).
 *
 * Pure helpers (frame expansion, ffmpeg arg builders) are tested directly; the
 * encodeGif orchestration is tested with injected fs/exec deps so no real
 * ffmpeg runs.
 *
 * Test contract: tools/screenshots/lib/__tests__/encode-gif.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import {
	expandFrames,
	frameFileName,
	buildPaletteGenArgs,
	buildPaletteUseArgs,
	encodeGif,
	type EncodeGifDeps,
} from "../encode-gif";

const buf = (n: number) => Buffer.from([n]);

describe("expandFrames", () => {
	it("repeats each frame round(holdMs/1000 * fps) times", () => {
		const out = expandFrames(
			[
				{ buffer: buf(1), holdMs: 1000 },
				{ buffer: buf(2), holdMs: 500 },
			],
			4,
		);
		// 1000ms*4fps = 4 ; 500ms*4fps = 2
		expect(out.length).toBe(6);
		expect(out.slice(0, 4).every((b) => b.equals(buf(1)))).toBe(true);
		expect(out.slice(4).every((b) => b.equals(buf(2)))).toBe(true);
	});

	it("never drops a frame below one repetition", () => {
		// 50ms * 2fps = 0.1 → round 0 → clamped to 1
		const out = expandFrames([{ buffer: buf(1), holdMs: 50 }], 2);
		expect(out.length).toBe(1);
	});

	it("throws on fps <= 0", () => {
		expect(() => expandFrames([{ buffer: buf(1), holdMs: 100 }], 0)).toThrow(
			/fps/,
		);
	});

	it("throws on empty frames", () => {
		expect(() => expandFrames([], 10)).toThrow(/no frames/);
	});

	it("throws on non-positive holdMs", () => {
		expect(() => expandFrames([{ buffer: buf(1), holdMs: 0 }], 10)).toThrow(
			/holdMs/,
		);
	});
});

describe("frame naming + ffmpeg arg builders", () => {
	it("zero-pads frame filenames to %05d", () => {
		expect(frameFileName(0)).toBe("frame-00000.png");
		expect(frameFileName(42)).toBe("frame-00042.png");
	});

	it("palettegen args carry framerate, input pattern, the palettegen filter, and output", () => {
		const args = buildPaletteGenArgs(
			"/tmp/f/frame-%05d.png",
			"/tmp/f/palette.png",
			8,
		);
		expect(args).toContain("-framerate");
		expect(args).toContain("8");
		expect(args).toContain("/tmp/f/frame-%05d.png");
		expect(args.join(" ")).toContain("palettegen");
		expect(args).toContain("/tmp/f/palette.png");
	});

	it("paletteuse args reference both inputs, the paletteuse filter, loop, and output", () => {
		const args = buildPaletteUseArgs(
			"/tmp/f/frame-%05d.png",
			"/tmp/f/palette.png",
			"/out/x.gif",
			8,
		);
		expect(args.join(" ")).toContain("paletteuse");
		expect(args).toContain("/tmp/f/palette.png");
		expect(args).toContain("/out/x.gif");
		expect(args).toContain("-loop");
		expect(args).toContain("0");
	});
});

describe("encodeGif", () => {
	function makeDeps(overrides: Partial<EncodeGifDeps> = {}): EncodeGifDeps {
		return {
			makeWorkDir: vi.fn().mockReturnValue("/tmp/work"),
			writeFrame: vi.fn(),
			runFfmpeg: vi.fn().mockResolvedValue(undefined),
			statBytes: vi.fn().mockReturnValue(1000),
			...overrides,
		};
	}

	it("writes expanded frames, runs ffmpeg twice (palettegen then paletteuse), returns counts", async () => {
		const deps = makeDeps();
		const res = await encodeGif(
			{
				frames: [{ buffer: buf(1), holdMs: 1000 }],
				fps: 3,
				outPath: "/out/x.gif",
				maxBytes: 5000,
			},
			deps,
		);
		expect(deps.writeFrame).toHaveBeenCalledTimes(3); // 1000ms*3fps
		expect(deps.runFfmpeg).toHaveBeenCalledTimes(2);
		const calls = (deps.runFfmpeg as ReturnType<typeof vi.fn>).mock.calls;
		expect((calls[0][0] as string[]).join(" ")).toContain("palettegen");
		expect((calls[1][0] as string[]).join(" ")).toContain("paletteuse");
		expect(res.frameCount).toBe(3);
		expect(res.bytes).toBe(1000);
	});

	it("throws when the output exceeds maxBytes", async () => {
		const deps = makeDeps({ statBytes: vi.fn().mockReturnValue(9999) });
		await expect(
			encodeGif(
				{
					frames: [{ buffer: buf(1), holdMs: 100 }],
					fps: 10,
					outPath: "/out/x.gif",
					maxBytes: 5000,
				},
				deps,
			),
		).rejects.toThrow(/exceeds/);
	});

	it("throws when the output is missing or empty", async () => {
		const deps = makeDeps({ statBytes: vi.fn().mockReturnValue(0) });
		await expect(
			encodeGif(
				{
					frames: [{ buffer: buf(1), holdMs: 100 }],
					fps: 10,
					outPath: "/out/x.gif",
					maxBytes: 5000,
				},
				deps,
			),
		).rejects.toThrow(/missing or empty/);
	});
});
