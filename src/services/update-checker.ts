/**
 * Agent Update Checker
 *
 * Checks built-in agent ACP adapters for:
 * 1. Package migration — deprecated packages that have been renamed
 * 2. Version updates — newer versions available on npm
 *
 * Pure functions (non-React). Network access is routed through net.ts.
 */

import { fetchJson } from "./net";
import * as semver from "semver";
import type { OverlayVariant } from "../types/errors";
import { t } from "../i18n";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent update notification to display in the UI.
 * Compatible with ErrorInfo shape (title/message/suggestion).
 */
export interface AgentUpdateNotification {
	/** Visual variant for the overlay */
	variant: OverlayVariant;
	/** Short notification title */
	title: string;
	/** Detailed notification message */
	message: string;
	/** Actionable suggestion (e.g., npm command) */
	suggestion?: string;
}

// ============================================================================
// Known Packages
// ============================================================================

/**
 * Maps agentInfo.name → npm package name.
 * Agents may report their name with or without the npm scope prefix,
 * so we handle both forms.
 */
const KNOWN_AGENT_PACKAGES: Readonly<Record<string, string>> = {
	"@agentclientprotocol/claude-agent-acp":
		"@agentclientprotocol/claude-agent-acp",
	"codex-acp": "@zed-industries/codex-acp",
};

/**
 * Deprecated agentInfo.name → replacement npm package name.
 * Used to detect users still running old/renamed packages.
 */
const DEPRECATED_PACKAGES: Readonly<Record<string, string>> = {
	"@zed-industries/claude-code-acp": "@agentclientprotocol/claude-agent-acp",
	"@zed-industries/claude-agent-acp": "@agentclientprotocol/claude-agent-acp",
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if the agent needs a package migration or version update.
 *
 * Priority: migration notification > version update notification.
 * - Migration is checked locally (no network) based on agentInfo.name.
 * - Version update queries the npm registry.
 *
 * @returns AgentUpdateNotification if action needed, null otherwise.
 */
export async function checkAgentUpdate(agentInfo: {
	name: string;
	version?: string;
}): Promise<AgentUpdateNotification | null> {
	// 1. Check for deprecated package (migration takes priority)
	const replacement = DEPRECATED_PACKAGES[agentInfo.name];
	if (replacement) {
		return {
			variant: "info",
			title: t("chat.updateBanner.migrationTitle"),
			message: t("chat.updateBanner.renamed", {
				old: agentInfo.name,
				new: replacement,
			}),
			suggestion: `npm uninstall -g ${agentInfo.name} && npm install -g ${replacement}`,
		};
	}

	// 2. Check for version update (known packages only)
	const npmPackage = KNOWN_AGENT_PACKAGES[agentInfo.name];
	if (!npmPackage || !agentInfo.version) {
		return null;
	}

	try {
		const latestVersion = await fetchLatestVersion(npmPackage);
		if (
			latestVersion &&
			semver.valid(agentInfo.version) &&
			semver.gt(latestVersion, agentInfo.version)
		) {
			return {
				variant: "info",
				title: t("chat.updateBanner.updateTitle"),
				message: t("chat.updateBanner.updateAvailable", {
					package: npmPackage,
					current: agentInfo.version,
					latest: latestVersion,
				}),
				suggestion: `npm install -g ${npmPackage}@latest`,
			};
		}
	} catch {
		// Silently ignore network errors — update check is best-effort
	}

	return null;
}

// ============================================================================
// Internal
// ============================================================================

/**
 * Fetch the latest version of an npm package from the registry.
 */
async function fetchLatestVersion(packageName: string): Promise<string | null> {
	const data = await fetchJson<{ version?: string }>(
		`https://registry.npmjs.org/${packageName}/latest`,
	);
	return data.version ? (semver.clean(data.version) ?? null) : null;
}
