import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
	PIN_FILE,
	appVersionProblem,
	pinDriftNote,
	readAppPin,
	releaseAsarUrl,
	resolveAppAsar,
	type AppPin,
} from "../obsidian-app";

const REPO = path.resolve(__dirname, "../../..");
const body = Buffer.from("pretend obsidian app asar");
const pin: AppPin = { version: "1.15.0", asarSha256: createHash("sha256").update(body).digest("hex") };

let root: string;
let cacheDir: string;
let userDataDir: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "obsidian-app-"));
	cacheDir = path.join(root, "cache");
	userDataDir = path.join(root, "userdata");
	mkdirSync(userDataDir);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readAppPin", () => {
	it("reads the committed pin: a release version and a sha256", () => {
		const p = readAppPin(REPO);
		expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(p.asarSha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it("rejects a pin without a valid version or hash", () => {
		const repo = path.join(root, "repo");
		mkdirSync(path.join(repo, path.dirname(PIN_FILE)), { recursive: true });
		writeFileSync(path.join(repo, PIN_FILE), JSON.stringify({ version: "latest", asarSha256: "abc" }));
		expect(() => readAppPin(repo)).toThrow(/version/);
	});
});

describe("resolveAppAsar", () => {
	it("uses a cached copy whose hash matches, without downloading", async () => {
		mkdirSync(cacheDir);
		writeFileSync(path.join(cacheDir, "obsidian-1.15.0.asar"), body);
		const download = vi.fn();
		const p = await resolveAppAsar(pin, { cacheDir, userDataDir, download });
		expect(p).toBe(path.join(cacheDir, "obsidian-1.15.0.asar"));
		expect(download).not.toHaveBeenCalled();
	});

	it("takes the user's downloaded copy when it matches, and caches it", async () => {
		writeFileSync(path.join(userDataDir, "obsidian-1.15.0.asar"), body);
		const download = vi.fn();
		const p = await resolveAppAsar(pin, { cacheDir, userDataDir, download });
		expect(readFileSync(p)).toEqual(body);
		expect(path.dirname(p)).toBe(cacheDir);
		expect(download).not.toHaveBeenCalled();
	});

	it("downloads and unzips the release asset when neither copy exists", async () => {
		const download = vi.fn().mockResolvedValue(gzipSync(body));
		const p = await resolveAppAsar(pin, { cacheDir, userDataDir, download });
		expect(download).toHaveBeenCalledWith(releaseAsarUrl("1.15.0"));
		expect(readFileSync(p)).toEqual(body);
	});

	it("ignores a user copy with the wrong hash and downloads instead", async () => {
		writeFileSync(path.join(userDataDir, "obsidian-1.15.0.asar"), Buffer.from("tampered"));
		const download = vi.fn().mockResolvedValue(gzipSync(body));
		const p = await resolveAppAsar(pin, { cacheDir, userDataDir, download });
		expect(download).toHaveBeenCalledTimes(1);
		expect(readFileSync(p)).toEqual(body);
	});

	it("rejects a download whose hash doesn't match the pin and caches nothing", async () => {
		const download = vi.fn().mockResolvedValue(gzipSync(Buffer.from("something else")));
		await expect(resolveAppAsar(pin, { cacheDir, userDataDir, download })).rejects.toThrow(/sha256/);
		expect(existsSync(path.join(cacheDir, "obsidian-1.15.0.asar"))).toBe(false);
	});
});

describe("resolveAppAsar — failures", () => {
	it("replaces a corrupt cached copy", async () => {
		mkdirSync(cacheDir);
		writeFileSync(path.join(cacheDir, "obsidian-1.15.0.asar"), "half-written");
		writeFileSync(path.join(userDataDir, "obsidian-1.15.0.asar"), body);
		const p = await resolveAppAsar(pin, { cacheDir, userDataDir, download: vi.fn() });
		expect(readFileSync(p)).toEqual(body);
	});

	it("never leaves a temp file behind from the local copy", async () => {
		writeFileSync(path.join(userDataDir, "obsidian-1.15.0.asar"), body);
		await resolveAppAsar(pin, { cacheDir, userDataDir, download: vi.fn() });
		const { readdirSync } = await import("node:fs");
		expect(readdirSync(cacheDir)).toEqual(["obsidian-1.15.0.asar"]);
	});

	it("propagates a failed download and caches nothing", async () => {
		const download = vi.fn().mockRejectedValue(new Error("offline"));
		await expect(resolveAppAsar(pin, { cacheDir, userDataDir, download })).rejects.toThrow(/offline/);
		expect(existsSync(path.join(cacheDir, "obsidian-1.15.0.asar"))).toBe(false);
	});

	it("names the URL when the download isn't a gzip", async () => {
		const download = vi.fn().mockResolvedValue(Buffer.from("<html>not found</html>"));
		await expect(resolveAppAsar(pin, { cacheDir, userDataDir, download })).rejects.toThrow(/obsidian-releases.*not a gzip|not a gzip.*obsidian-releases/);
	});
});

describe("release URL", () => {
	it("points at the official obsidian-releases asset", () => {
		expect(releaseAsarUrl("1.15.0")).toBe("https://github.com/obsidianmd/obsidian-releases/releases/download/v1.15.0/obsidian-1.15.0.asar.gz");
	});
});

describe("appVersionProblem", () => {
	it("is null when the instance runs the pinned version", () => {
		expect(appVersionProblem("1.15.0", pin)).toBeNull();
	});

	it("names both versions when the instance runs something else", () => {
		expect(appVersionProblem("1.14.5", pin)).toMatch(/1\.14\.5.*1\.15\.0/);
	});

	it("reports an unreadable version", () => {
		expect(appVersionProblem(null, pin)).toMatch(/couldn't read/);
	});
});

describe("pinDriftNote", () => {
	it("is null when the user's Obsidian matches the pin, or is unknown", () => {
		expect(pinDriftNote({ version: "1.15.0", source: "running app" }, pin)).toBeNull();
		expect(pinDriftNote({ version: null, source: "unknown" }, pin)).toBeNull();
	});

	it("tells the user which file to bump when their Obsidian has moved on", () => {
		const n = pinDriftNote({ version: "1.16.0", source: "running app (downloaded update)" }, pin);
		expect(n).toContain("1.16.0");
		expect(n).toContain(PIN_FILE);
	});
});
