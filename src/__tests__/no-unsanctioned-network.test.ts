import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * PR-time tripwire: the ONLY module allowed to perform outbound network I/O is
 * src/services/net.ts. Every other source file under src/ must be egress-free.
 *
 * Agent Console's sole network use is best-effort version checks (GitHub
 * Releases API + npm registry) routed through net.ts; none carry vault data.
 * This guard makes that auditable claim enforceable: a PR that adds fetch(),
 * XMLHttpRequest, WebSocket, navigator.sendBeacon, Obsidian's requestUrl, or a
 * node http/https/net/tls/dgram import anywhere except net.ts fails CI here
 * (runs via `npm test`).
 *
 * This is defense-in-depth plus an accidental-introduction catch — NOT a
 * complete control. A determined contributor can still egress via dynamic
 * dispatch, obfuscation, or a transitive dependency. CODEOWNERS review and the
 * dependency-review CI job cover those vectors. See CONTRIBUTING.md
 * § Network egress policy.
 */

// The single file permitted to contain network primitives (path relative to src/).
const ALLOWED_NETWORK_FILE = "services/net.ts";

// Network egress primitives. Each pattern is call/usage-shaped (or an import)
// so it does not match prose; comments are stripped before scanning as well.
const NETWORK_PATTERNS: { name: string; re: RegExp }[] = [
	{ name: "Obsidian requestUrl", re: /\brequestUrl\b/ },
	{ name: "fetch()", re: /\bfetch\s*\(/ },
	{ name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
	{ name: "WebSocket", re: /\bWebSocket\b/ },
	{ name: "navigator.sendBeacon", re: /\bsendBeacon\b/ },
	{
		name: "node net-module import",
		re: /\bfrom\s+["'](?:node:)?(?:http|https|net|tls|dgram)["']/,
	},
	{
		name: "node net-module require",
		re: /\brequire\(\s*["'](?:node:)?(?:http|https|net|tls|dgram)["']\s*\)/,
	},
];

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	".trees",
	"dist",
	"build",
	"coverage",
	"__tests__",
	"__test_stubs__",
	"__benchmarks__",
]);

function collectSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			out.push(...collectSourceFiles(full));
		} else if (
			/\.tsx?$/.test(entry) &&
			!/\.(test|spec|bench)\.tsx?$/.test(entry)
		) {
			out.push(full);
		}
	}
	return out;
}

// Strip comments so JSDoc/prose references to these APIs do not trip the scan.
// The line-comment guard preserves "https://" and other "://" sequences in
// string literals.
function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("network egress is centralised in net.ts", () => {
	it("the allowlisted egress module exists and uses requestUrl", () => {
		const netPath = join(process.cwd(), "src", ALLOWED_NETWORK_FILE);
		expect(existsSync(netPath), `${ALLOWED_NETWORK_FILE} must exist`).toBe(
			true,
		);
		expect(readFileSync(netPath, "utf8")).toMatch(/\brequestUrl\b/);
	});

	it("no source file outside net.ts performs network egress", () => {
		const root = join(process.cwd(), "src");
		const allowedFull = join(root, ALLOWED_NETWORK_FILE);
		const offenders: string[] = [];

		for (const file of collectSourceFiles(root)) {
			if (file === allowedFull) continue;
			const src = stripComments(readFileSync(file, "utf8"));
			for (const { name, re } of NETWORK_PATTERNS) {
				if (re.test(src)) {
					offenders.push(
						`${file.replace(process.cwd() + "/", "")}: ${name}`,
					);
				}
			}
		}

		expect(
			offenders,
			"Unsanctioned network egress found outside src/services/net.ts.\n" +
				"Route the call through net.ts (fetchJson) and add its host to " +
				"ALLOWED_HOSTS, or remove it. See CONTRIBUTING.md " +
				"§ Network egress policy:\n" +
				offenders.join("\n"),
		).toEqual([]);
	});
});
