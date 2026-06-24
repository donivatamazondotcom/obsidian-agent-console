import * as React from "react";
const { useRef, useEffect } = React;
import {
	Component,
	FileSystemAdapter,
	MarkdownRenderer as ObsidianMarkdownRenderer,
	Notice,
	Platform,
} from "obsidian";
import { convertWslPathToWindows } from "../../utils/platform";
import { isAbsolutePath } from "../../utils/paths";
import { deriveNewLeaf, HOVER_LINK_SOURCE } from "../../utils/link-leaf";
import type AgentClientPlugin from "../../plugin";

interface MarkdownRendererProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function MarkdownRenderer({ text, plugin }: MarkdownRendererProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		el.empty?.();
		el.classList.add("markdown-rendered");

		// Create a temporary component for the markdown renderer lifecycle
		const component = new Component();
		component.load();

		// Resolve links relative to the active file so an ambiguous basename
		// resolves the same way it would from that note (C). Chat has no
		// backing file of its own; the active file is the natural source.
		const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";

		// Render markdown
		void ObsidianMarkdownRenderer.render(
			plugin.app,
			text,
			el,
			sourcePath,
			component,
		);

		// Handle internal link clicks
		const vaultBasePath =
			plugin.app.vault.adapter instanceof FileSystemAdapter
				? plugin.app.vault.adapter.getBasePath()
				: null;

		// Prepare normalized vault base path for comparison (forward slashes)
		const isWslMode = Platform.isWin && plugin.settings.windowsWslMode;
		const normalizedVaultBase = vaultBasePath
			? vaultBasePath.replace(/\\/g, "/").replace(/\/+$/, "")
			: null;

		const handleInternalLinkClick = (e: MouseEvent) => {
			// Only act on left-click (0) and middle-click (1). Right-click (2)
			// arrives via `auxclick`; leave it untouched so the default context
			// menu still appears (custom link context menu is out of scope here).
			if (e.button !== 0 && e.button !== 1) return;
			const target = e.target as HTMLElement;
			const link = target.closest("a.internal-link");
			if (link) {
				e.preventDefault();
				// Dead link: Obsidian tags an internal link whose target does
				// not exist with `.is-unresolved`. Don't silently create a
				// stray note via openLinkText (its default for a missing
				// target) — surface a notice and bail.
				if (link.classList.contains("is-unresolved")) {
					const missing = link.getAttribute("data-href");
					new Notice(
						`Note not found: ${
							missing
								? decodeURIComponent(missing)
								: "unknown"
						}`,
					);
					return;
				}
				const rawHref = link.getAttribute("data-href");
				if (rawHref) {
					let href = decodeURIComponent(rawHref);

					// WSL mode: convert /mnt/c/... paths to Windows format
					if (isWslMode && href.startsWith("/mnt/")) {
						href = convertWslPathToWindows(href);
					}

					// Normalize for comparison (forward slashes)
					const normalizedHref = href.replace(/\\/g, "/");

					// Modifier/middle-click → target pane; plain click → false
					// (honors the global alwaysOpenInNewTab setting).
					const newLeaf = deriveNewLeaf(e);

					if (
						normalizedVaultBase &&
						normalizedHref.startsWith(normalizedVaultBase + "/")
					) {
						// Absolute vault path → convert to relative
						const relativePath = normalizedHref.slice(
							normalizedVaultBase.length + 1,
						);
						void plugin.app.workspace.openLinkText(
							relativePath,
							sourcePath,
							newLeaf,
						);
					} else if (!isAbsolutePath(href)) {
						// Already relative or wiki-link style — pass through
						void plugin.app.workspace.openLinkText(
							href,
							sourcePath,
							newLeaf,
						);
					}
					// Absolute path outside vault — ignore
				}
			}
		};
		// Page Preview integration (A): dispatch `hover-link` so the core
		// Page Preview plugin shows the file popover (and the "hold Mod to
		// open" hint) for chat links, matching native editor behavior. The
		// view registers as a hover source under HOVER_LINK_SOURCE in
		// plugin.ts; the `source` here must match that id.
		const handleInternalLinkHover = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const link = target.closest("a.internal-link");
			if (!link) return;
			const linktext = link.getAttribute("data-href");
			if (!linktext) return;
			plugin.app.workspace.trigger("hover-link", {
				event: e,
				source: HOVER_LINK_SOURCE,
				hoverParent: { hoverPopover: null },
				targetEl: link,
				linktext: decodeURIComponent(linktext),
				sourcePath,
			});
		};

		el.addEventListener("click", handleInternalLinkClick);
		// `auxclick` carries middle-click (and right-click, which the handler
		// ignores). Required because `click` never fires for the middle button.
		el.addEventListener("auxclick", handleInternalLinkClick);
		el.addEventListener("mouseover", handleInternalLinkHover);

		return () => {
			el.removeEventListener("click", handleInternalLinkClick);
			el.removeEventListener("auxclick", handleInternalLinkClick);
			el.removeEventListener("mouseover", handleInternalLinkHover);
			component.unload();
		};
	}, [text, plugin]);

	return (
		<div
			ref={containerRef}
			className="agent-client-markdown-text-renderer"
		/>
	);
}
