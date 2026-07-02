/**
 * Tests for presentation framing (Decision 11).
 *
 * Pure builders (gradient/mask/chrome/shadow SVG) + resolveFrameConfig are
 * tested directly. frameImage runs REAL sharp on a tiny generated PNG (sharp is
 * pure/fast — same convention as shadow.test.ts) to assert the framed output's
 * dimensions and validity.
 *
 * Test contract: tools/screenshots/lib/__tests__/frame.test.ts.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { ManifestEntry } from "../manifest";
import {
	gradientSvg,
	roundedRectMaskSvg,
	chromeBarSvg,
	shadowLayerSvg,
	resolveFrameConfig,
	frameImage,
	chromeOnlyFrame,
} from "../frame";

function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
	return {
		name: "f",
		width: 100,
		height: 60,
		crop: { x: 0, y: 0, width: 100, height: 60 },
		...overrides,
	};
}

// libvips caches metadata by filename; disable so post-overwrite reads see fresh dims.
beforeAll(() => sharp.cache(false));

describe("pure SVG builders", () => {
	it("gradientSvg has a diagonal two-stop linear gradient and rounded matte", () => {
		const svg = gradientSvg(200, 100, { from: "#111111", to: "#222222" });
		expect(svg).toContain("<linearGradient");
		expect(svg).toContain('x2="100%"');
		expect(svg).toContain('stop-color="#111111"');
		expect(svg).toContain('stop-color="#222222"');
		expect(svg).toContain('width="200"');
		expect(svg).toMatch(/rx="\d+"/);
	});

	it("roundedRectMaskSvg is a white rounded rect (dest-in mask)", () => {
		const svg = roundedRectMaskSvg(80, 40, 12);
		expect(svg).toContain('fill="#fff"');
		expect(svg).toContain('rx="12"');
		expect(svg).toContain('width="80"');
	});

	it("chromeBarSvg has a dark bar and three traffic-light dots", () => {
		const svg = chromeBarSvg(300, 30);
		expect(svg).toContain('fill="#2c2c2e"');
		expect(svg).toContain('fill="#ff5f56"');
		expect(svg).toContain('fill="#ffbd2e"');
		expect(svg).toContain('fill="#27c93f"');
		expect((svg.match(/<circle/g) ?? []).length).toBe(3);
	});

	it("shadowLayerSvg draws a low-opacity inset rect (room to diffuse), not a full-canvas slab", () => {
		const svg = shadowLayerSvg(240, 160, 100, 80, 70, 20, 16, 0.45);
		expect(svg).toContain('fill-opacity="0.45"');
		// Inset: the rect is offset from the canvas origin by the padding.
		expect(svg).toContain('x="70"');
		expect(svg).toContain('y="90"'); // pad(70) + offsetY(20)
		expect(svg).toContain('width="100"'); // winW, smaller than canvas 240
	});
});

describe("resolveFrameConfig", () => {
	it("returns null when the entry does not opt in", () => {
		expect(resolveFrameConfig(entry({}))).toBeNull();
		expect(resolveFrameConfig(entry({ frame: false }))).toBeNull();
	});

	it("hero + frame:true → full framed window (macos chrome, fork blue→cyan gradient)", () => {
		const cfg = resolveFrameConfig(entry({ frame: true, placement: "hero" }));
		expect(cfg).not.toBeNull();
		expect(cfg!.chrome).toBe("macos");
		expect(cfg!.background.from).toBe("#1d4ed8");
		expect(cfg!.chromeHeight).toBeGreaterThan(0);
	});

	it("feature/other + frame:true → chrome-less card", () => {
		const cfg = resolveFrameConfig(entry({ frame: true, placement: "feature" }));
		expect(cfg!.chrome).toBe("none");
		// card shares the cohesive fork gradient (both non-upstream)
		expect(cfg!.background.from).toBe("#1d4ed8");
	});

	it("object overrides win and merge over placement defaults", () => {
		const cfg = resolveFrameConfig(
			entry({
				frame: { chrome: "none", padding: 42, background: { from: "#abcdef" } },
				placement: "hero",
			}),
		);
		expect(cfg!.chrome).toBe("none"); // overridden
		expect(cfg!.padding).toBe(42); // overridden
		expect(cfg!.background.from).toBe("#abcdef"); // overridden
		expect(cfg!.background.to).toBe("#06b6d4"); // merged from hero default
		expect(cfg!.cornerRadius).toBe(22); // hero default retained
	});
});

describe("frameImage (real sharp)", () => {
	async function makeInput(w: number, h: number): Promise<string> {
		const dir = mkdtempSync(path.join(tmpdir(), "frame-test-"));
		const p = path.join(dir, "in.webp");
		await sharp({
			create: { width: w, height: h, channels: 4, background: { r: 40, g: 90, b: 200, alpha: 1 } },
		})
			.webp()
			.toFile(p);
		return p;
	}

	it("chrome-less card grows by 2×padding on each axis and stays a valid webp", async () => {
		const p = await makeInput(100, 60);
		await frameImage(p, {
			chrome: "none",
			background: { from: "#111111", to: "#222222" },
			cornerRadius: 8,
			padding: 10,
			chromeHeight: 0,
			shadow: { opacity: 0.4, blur: 4, offsetY: 4 },
		});
		const m = await sharp(p).metadata();
		expect(m.width).toBe(120); // 100 + 2*10
		expect(m.height).toBe(80); // 60 + 2*10
		expect(m.hasAlpha).toBe(true); // rounded matte corners → transparency
	});

	it("macos chrome adds the title-bar height before padding", async () => {
		const p = await makeInput(100, 60);
		await frameImage(p, {
			chrome: "macos",
			background: { from: "#111111", to: "#222222" },
			cornerRadius: 8,
			padding: 10,
			chromeHeight: 20,
			shadow: { opacity: 0.4, blur: 4, offsetY: 4 },
		});
		const m = await sharp(p).metadata();
		expect(m.width).toBe(120); // 100 + 2*10
		expect(m.height).toBe(100); // (60 + 20 chrome) + 2*10
	});
});

describe("chromeOnlyFrame (animation-GIF chrome, no gradient matte)", () => {
	it("stacks a macOS chrome bar above the content, same width, opaque", async () => {
		// Content: a solid mid-tone tile so we can tell it apart from the
		// dark chrome bar (#2c2c2e ≈ rgb(44,44,46)).
		const content = await sharp({
			create: {
				width: 40,
				height: 30,
				channels: 4,
				background: { r: 20, g: 120, b: 200, alpha: 1 },
			},
		})
			.png()
			.toBuffer();

		const out = await chromeOnlyFrame(content, { chromeHeight: 12 });

		const meta = await sharp(out).metadata();
		expect(meta.width).toBe(40); // width unchanged
		expect(meta.height).toBe(42); // 30 content + 12 chrome bar

		// Row 0 is the chrome bar, not the content — green channel of the
		// top-left pixel is the dark bar (~44), well below the content's 120.
		const { data, info } = await sharp(out)
			.raw()
			.toBuffer({ resolveWithObject: true });
		expect(info.channels).toBeGreaterThanOrEqual(3);
		expect(data[1]).toBeLessThan(80);
	});
});
