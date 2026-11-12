/**
 * The Obsidian app version isolated captures run on.
 *
 * `/Applications/Obsidian.app` is only the installer: Obsidian loads the
 * newest `obsidian-<v>.asar` from its user-data folder, and a fresh isolated
 * user-data folder has none, so without help the instance runs the installer's
 * bundled app version. The fixtures pin one version (`obsidian-app.json`);
 * every run copies that version's asar into its user data and asserts the
 * instance actually runs it.
 *
 * `navigator.userAgent` reports the installer version, not the app version;
 * read the app version with `ipcRenderer.sendSync("version")`.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Shared harness.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

/** The pin, relative to the repo root. Bump `version` and `asarSha256` together. */
export const PIN_FILE = "tools/screenshots/fixtures/obsidian-app.json";

export interface AppPin {
	version: string;
	/** sha256 of the uncompressed `obsidian-<version>.asar`. */
	asarSha256: string;
}

export function readAppPin(repoRoot: string): AppPin {
	const raw = JSON.parse(readFileSync(path.join(repoRoot, PIN_FILE), "utf8")) as Partial<AppPin>;
	if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.version)) throw new Error(`${PIN_FILE}: "version" must be a release version like 1.15.0`);
	if (typeof raw.asarSha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.asarSha256)) throw new Error(`${PIN_FILE}: "asarSha256" must be a lowercase sha256`);
	return { version: raw.version, asarSha256: raw.asarSha256 };
}

export const asarName = (version: string): string => `obsidian-${version}.asar`;

/** The official update asset, the same file Obsidian's own updater downloads. */
export const releaseAsarUrl = (version: string): string =>
	`https://github.com/obsidianmd/obsidian-releases/releases/download/v${version}/${asarName(version)}.gz`;

export const DEFAULT_CACHE_DIR = path.join(homedir(), "Library/Caches/agent-console");
export const USER_DATA_DIR = path.join(homedir(), "Library/Application Support/obsidian");

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const matches = (file: string, pin: AppPin): boolean => existsSync(file) && sha256(readFileSync(file)) === pin.asarSha256;

export interface ResolveDeps {
	cacheDir?: string;
	/** The user's Obsidian user-data folder; its downloaded update is reused when it matches. */
	userDataDir?: string;
	download?: (url: string) => Promise<Buffer>;
}

/** curl, like the rest of the macOS-only harness's tool calls; follows GitHub's redirect. */
function httpDownload(url: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		execFile("curl", ["-fsSL", "--max-time", "300", url], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
			if (err) reject(new Error(`download failed (${url}): ${err.message}`));
			else resolve(stdout);
		});
	});
}

/**
 * Path to a verified copy of the pinned asar: the cache, else the user's own
 * downloaded update, else the release asset (downloaded once). Every source is
 * checked against the pinned sha256; nothing unverified is cached.
 */
export async function resolveAppAsar(pin: AppPin, deps: ResolveDeps = {}): Promise<string> {
	const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR;
	const cached = path.join(cacheDir, asarName(pin.version));
	if (matches(cached, pin)) return cached;
	mkdirSync(cacheDir, { recursive: true });
	const tmp = `${cached}.${process.pid}.tmp`;
	const local = path.join(deps.userDataDir ?? USER_DATA_DIR, asarName(pin.version));
	if (matches(local, pin)) {
		// Copy, re-verify, then rename, so a reader never sees a partial file.
		copyFileSync(local, tmp);
		if (matches(tmp, pin)) {
			renameSync(tmp, cached);
			return cached;
		}
		rmSync(tmp, { force: true });
	}
	const url = releaseAsarUrl(pin.version);
	const gz = await (deps.download ?? httpDownload)(url);
	let body: Buffer;
	try {
		body = gunzipSync(gz);
	} catch (e) {
		throw new Error(`the download from ${url} is not a gzip (${e instanceof Error ? e.message : String(e)})`);
	}
	const got = sha256(body);
	if (got !== pin.asarSha256) throw new Error(`${asarName(pin.version)} from ${url} has sha256 ${got}, not the pinned ${pin.asarSha256}`);
	writeFileSync(tmp, body);
	renameSync(tmp, cached);
	return cached;
}

/** The app version a workspace page runs (not the installer's), or null if unreadable. */
export async function readInstanceAppVersion(page: { evaluate<T>(fn: () => T): Promise<T> }): Promise<string | null> {
	return page
		.evaluate(() => {
			const r = (window as unknown as { require(m: string): { ipcRenderer: { sendSync(ch: string): unknown } } }).require("electron");
			const v = r.ipcRenderer.sendSync("version");
			return typeof v === "string" ? v : null;
		})
		.catch(() => null);
}

/** Why the instance's app version is wrong, or null when it runs the pin. */
export function appVersionProblem(instanceVersion: string | null, pin: AppPin): string | null {
	if (!instanceVersion) return "couldn't read the isolated Obsidian's app version";
	if (instanceVersion === pin.version) return null;
	return `the isolated Obsidian runs ${instanceVersion}, not the pinned ${pin.version}; /Applications/Obsidian.app may be too old to load it (reinstall from obsidian.md)`;
}

/** A note when the user's own Obsidian has moved past the pin; null otherwise. */
export function pinDriftNote(user: { version: string | null; source: string }, pin: AppPin): string | null {
	if (!user.version || user.version === pin.version) return null;
	return `your Obsidian runs ${user.version} (${user.source}); captures use the pinned ${pin.version}. To reshoot on ${user.version}, bump ${PIN_FILE} (version and asarSha256).`;
}
