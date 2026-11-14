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
	trafficLightsSvg,
	TRAFFIC_LIGHTS,
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

// Isolated heroes are captured from the page, which has no window chrome:
// macOS draws the traffic lights. The frame adds them back, colored as in a
// focused window, where the committed heroes show them (PR 2c).
describe("traffic lights (isolated heroes, PR 2c)", () => {
	it("draws three colored lights at the window's own spots, scaled to the image", () => {
		const svg = trafficLightsSvg(1400, 875, 0.875);
		expect(svg).toContain('width="1400"');
		expect(svg).toContain('height="875"');
		const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="(#[0-9a-f]{6})"/g)];
		expect(circles.map((c) => c[4])).toEqual(TRAFFIC_LIGHTS.colors);
		for (const [i, c] of circles.entries()) {
			expect(Number(c[1])).toBeCloseTo((TRAFFIC_LIGHTS.firstX + i * TRAFFIC_LIGHTS.step) * 0.875, 5);
			expect(Number(c[2])).toBeCloseTo(TRAFFIC_LIGHTS.y * 0.875, 5);
			expect(Number(c[3])).toBeCloseTo(TRAFFIC_LIGHTS.radius * 0.875, 5);
		}
	});

	it("sits where the committed, really captured hero shows its lights", () => {
		// editor-quickprompts (real chrome, 1600 pt window downscaled to 1400
		// px, framed with 60 px padding): red at (78, 76), yellow (98, 76),
		// green (118, 76), each about 13 px across.
		const s = 0.875;
		const centers = [0, 1, 2].map((i) => [60 + (TRAFFIC_LIGHTS.firstX + i * TRAFFIC_LIGHTS.step) * s, 60 + TRAFFIC_LIGHTS.y * s]);
		expect(centers.map(([x]) => Math.round(x))).toEqual([78, 98, 118]);
		expect(Math.round(centers[0][1])).toBe(76);
		expect(Math.round(2 * TRAFFIC_LIGHTS.radius * s)).toBe(12);
	});

	it("frameImage paints them on the content when asked, and not otherwise", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "frame-lights-"));
		const make = async (name: string) => {
			const p = path.join(dir, name);
			await sharp({ create: { width: 200, height: 120, channels: 4, background: { r: 30, g: 30, b: 36, alpha: 1 } } }).webp().toFile(p);
			return p;
		};
		const opts = {
			chrome: "none" as const,
			background: { from: "#111111", to: "#222222" },
			cornerRadius: 4,
			padding: 10,
			chromeHeight: 0,
			shadow: { opacity: 0.4, blur: 4, offsetY: 4 },
		};
		const red = async (p: string) => {
			const x = Math.round(10 + TRAFFIC_LIGHTS.firstX);
			const y = Math.round(10 + TRAFFIC_LIGHTS.y);
			const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
			const i = (y * info.width + x) * info.channels;
			return [data[i], data[i + 1], data[i + 2]];
		};
		const lit = await make("lit.webp");
		await frameImage(lit, { ...opts, trafficLights: { scale: 1 } });
		const [r, g] = await red(lit);
		expect(r).toBeGreaterThan(200);
		expect(g).toBeLessThan(130);
		const plain = await make("plain.webp");
		await frameImage(plain, opts);
		expect((await red(plain))[0]).toBeLessThan(80);
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
