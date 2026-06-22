/**
 * net.ts — the ONLY module permitted to perform outbound network I/O.
 *
 * Agent Console's sole network egress is best-effort version checks against a
 * fixed host allowlist; none of these calls carry vault or conversation data.
 * Centralising egress here makes that guarantee auditable: the
 * `no-unsanctioned-network` tripwire test asserts that network primitives
 * (requestUrl, fetch, XMLHttpRequest, WebSocket, sendBeacon, and node
 * http/https/net/tls/dgram imports) appear in this file and nowhere else under
 * src/.
 *
 * To add an endpoint: extend ALLOWED_HOSTS below and document why in
 * CONTRIBUTING.md § Network egress policy. Do NOT add network calls elsewhere —
 * the tripwire will fail the PR.
 */
import { requestUrl } from "obsidian";

/**
 * Hosts Agent Console is permitted to reach. All calls are GET-only version
 * checks; none carry vault data.
 */
export const ALLOWED_HOSTS: readonly string[] = [
	"api.github.com", // plugin self-update check (GitHub Releases API)
	"registry.npmjs.org", // built-in agent npm version check
];

/**
 * Perform a sanctioned GET and return the parsed JSON body.
 *
 * Rejects any URL whose host is not in {@link ALLOWED_HOSTS}, so a mistyped or
 * newly introduced endpoint fails loudly at runtime as well as at review time.
 *
 * @throws if the host is not allowlisted, or the request itself fails.
 */
export async function fetchJson<T>(url: string): Promise<T> {
	const host = new URL(url).host;
	if (!ALLOWED_HOSTS.includes(host)) {
		throw new Error(
			`Unsanctioned network egress blocked: "${host}" is not in net.ts ALLOWED_HOSTS`,
		);
	}
	const response = await requestUrl({ url });
	return response.json as T;
}
