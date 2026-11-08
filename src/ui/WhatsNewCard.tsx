/**
 * "What's new" card (I300), shown once per chat view after an update.
 *
 * It lives above the tab panels (TabsLayout's `notice` slot, or the top of
 * the zero-tab landing), never inside a panel: every tab's panel stays
 * mounted, so anything shown "once" must not live in ChatPanel (I206).
 *
 * Hot path: the card is memoized on stable props and subscribes to three
 * primitives only (`lastSeenVersion`, `tabDisplay`, the forced flag), so
 * per-turn session saves, rail width commits and tab switches don't render
 * it. ChatView doesn't subscribe at all – `useWhatsNewNotice` hands it one
 * stable element.
 */
import * as React from "react";
const { useMemo, useRef, useEffect, useId, useSyncExternalStore } = React;
import { setIcon } from "obsidian";
import type { AgentClientPluginSettings, TabDisplay } from "../plugin";
import {
	deriveWhatsNewHighlights,
	nextLastSeenVersion,
	releaseCore,
	releaseNotesUrl,
	type WhatsNewHighlight,
} from "../resolvers/whats-new";
import { HIGHLIGHTS } from "../whats-new/highlights";
import type { WhatsNewForcedStore } from "../whats-new/forced-store";
import { t } from "../i18n";
import { getLogger } from "../utils/logger";

export interface WhatsNewSettingsStore {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => {
		lastSeenVersion?: string;
		tabDisplay: TabDisplay;
	};
	updateSettings: (
		updates: Partial<AgentClientPluginSettings>,
	) => Promise<void>;
}

interface WhatsNewCardProps {
	settingsStore: WhatsNewSettingsStore;
	forcedStore: WhatsNewForcedStore;
	currentVersion: string;
	/** Test seam: the shipped registry by default. */
	highlights?: readonly WhatsNewHighlight[];
}

function logWriteFailure(what: string) {
	return (err: unknown) =>
		getLogger().warn(`[What's new] Couldn't save ${what}:`, err);
}

function DismissButton({ onClick }: { onClick: () => void }) {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "x");
	}, []);
	return (
		<button
			ref={ref}
			type="button"
			className="clickable-icon agent-client-whats-new-dismiss"
			aria-label={t("chat.whatsNew.dismiss")}
			onClick={onClick}
		/>
	);
}

function WhatsNewCardImpl({
	settingsStore,
	forcedStore,
	currentVersion,
	highlights = HIGHLIGHTS,
}: WhatsNewCardProps) {
	const lastSeen = useSyncExternalStore(
		settingsStore.subscribe,
		() => settingsStore.getSnapshot().lastSeenVersion,
		() => settingsStore.getSnapshot().lastSeenVersion,
	);
	const tabDisplay = useSyncExternalStore(
		settingsStore.subscribe,
		() => settingsStore.getSnapshot().tabDisplay,
		() => settingsStore.getSnapshot().tabDisplay,
	);
	const forced = useSyncExternalStore(
		forcedStore.subscribe,
		forcedStore.get,
		forcedStore.get,
	);
	const headingId = useId();

	const current = useMemo(
		() => releaseCore(currentVersion),
		[currentVersion],
	);
	const shown = useMemo(
		() =>
			current === undefined
				? []
				: deriveWhatsNewHighlights({
						highlights,
						current,
						lastSeen,
						forced,
					}),
		[highlights, current, lastSeen, forced],
	);

	if (current === undefined || shown.length === 0) return null;

	const notesUrl = releaseNotesUrl(current);

	const onDismiss = () => {
		forcedStore.set(false);
		settingsStore
			.updateSettings({
				lastSeenVersion: nextLastSeenVersion(lastSeen, current),
			})
			.catch(logWriteFailure("the dismissed version"));
	};

	const onToggleTabDisplay = () => {
		const next: TabDisplay =
			tabDisplay === "vertical" ? "horizontal" : "vertical";
		settingsStore
			.updateSettings({ tabDisplay: next })
			.catch(logWriteFailure("the tab display"));
	};

	const renderAction = (h: WhatsNewHighlight) => {
		if (!h.action) return null;
		switch (h.action.kind) {
			case "toggleTabDisplay":
				return (
					<button
						type="button"
						className="agent-client-whats-new-action"
						onClick={onToggleTabDisplay}
					>
						{tabDisplay === "vertical"
							? t("chat.whatsNew.switchBackToTopTabs")
							: t("chat.whatsNew.tryVerticalTabs")}
					</button>
				);
		}
	};

	return (
		<div
			className="agent-client-whats-new"
			role="region"
			aria-labelledby={headingId}
		>
			<div className="agent-client-whats-new-header">
				<div id={headingId} className="agent-client-whats-new-heading">
					{t("chat.whatsNew.heading")}
				</div>
				<DismissButton onClick={onDismiss} />
			</div>
			{shown.map((h) => (
				<div key={h.id} className="agent-client-whats-new-item">
					<div className="agent-client-whats-new-title">
						{t(h.titleKey)}
					</div>
					<div className="agent-client-whats-new-body">
						{t(h.bodyKey)}
					</div>
					{renderAction(h)}
				</div>
			))}
			{notesUrl !== undefined && (
				<a
					className="agent-client-whats-new-link"
					href={notesUrl}
					target="_blank"
					rel="noopener"
				>
					{t("chat.whatsNew.releaseNotes")}
				</a>
			)}
		</div>
	);
}

export const WhatsNewCard = React.memo(WhatsNewCardImpl);

/** What `useWhatsNewNotice` needs from the plugin (stable references). */
export interface WhatsNewHost {
	settingsService: WhatsNewSettingsStore;
	whatsNewForced: WhatsNewForcedStore;
	manifest: { version: string };
}

/**
 * One stable card element for a chat view. Call it next to `useTabDisplay`,
 * ABOVE ChatView's zero-tab early return: calling it beside the TabsLayout
 * JSX would change the hook count between the landing and tabs and crash
 * with "Rendered more hooks".
 */
export function useWhatsNewNotice(host: WhatsNewHost): React.ReactElement {
	const { settingsService, whatsNewForced } = host;
	const version = host.manifest.version;
	return useMemo(
		() => (
			<WhatsNewCard
				settingsStore={settingsService}
				forcedStore={whatsNewForced}
				currentVersion={version}
			/>
		),
		[settingsService, whatsNewForced, version],
	);
}
