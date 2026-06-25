import * as React from "react";
const { useState, useMemo } = React;
import { FileSystemAdapter } from "obsidian";
import type { MessageContent } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import { TerminalBlock } from "./TerminalBlock";
import { PermissionBanner } from "./PermissionBanner";
import { LucideIcon } from "./shared/IconButton";
import { toRelativePath } from "../utils/paths";
import {
	countLines,
	formatRawPayload,
	hasRenderableContent,
} from "../utils/toolCallSummary";
import {
	computeDiffLines,
	isNewFile,
	type DiffLine,
} from "../utils/toolCallDiff";
// import { MarkdownRenderer } from "./shared/MarkdownRenderer";

// Re-exported so existing importers (e.g. the I78 word-diff test) keep their
// `../ToolCallBlock` import path after computeDiffLines moved to utils.
export { computeDiffLines };

interface ToolCallBlockProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: AgentClientPlugin;
	terminalClient?: AcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

export const ToolCallBlock = React.memo(function ToolCallBlock({
	content,
	plugin,
	terminalClient,
	onApprovePermission,
}: ToolCallBlockProps) {
	const {
		kind,
		title,
		status,
		permissionRequest,
		locations,
		rawInput,
		content: toolContent,
	} = content;

	// Local state for selected option (for immediate UI feedback)
	const [selectedOptionId, setSelectedOptionId] = useState<
		string | undefined
	>(permissionRequest?.selectedOptionId);

	// Update selectedOptionId when permissionRequest changes
	React.useEffect(() => {
		if (permissionRequest?.selectedOptionId !== selectedOptionId) {
			setSelectedOptionId(permissionRequest?.selectedOptionId);
		}
	}, [permissionRequest?.selectedOptionId]);

	// Get vault path for relative path display
	const vaultPath = useMemo(() => {
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return "";
	}, [plugin]);

	// Get showEmojis setting
	const showEmojis = plugin.settings.displaySettings.showEmojis;

	// Get Lucide icon name based on tool kind
	const getKindIconName = (kind?: string): string => {
		switch (kind) {
			case "read":
				return "book-open";
			case "edit":
				return "pencil";
			case "delete":
				return "trash";
			case "move":
				return "folder-open";
			case "search":
				return "search";
			case "execute":
				return "square-terminal";
			case "think":
				return "message-circle-more";
			case "fetch":
				return "globe";
			case "switch_mode":
				return "arrow-left-right";
			default:
				return "hammer";
		}
	};

	// ============================================================
	// Compact tool-call render — the block is collapsed by default
	// to one summary row. Click expands to the full body. See
	// 04-initiatives/Agent Console/Agent Console Compact Tool Calls.md
	// for the full design (C3 lands the click-to-expand baseline; C4
	// adds status icon, C5 adds live preview line).
	// ============================================================

	// Pending permission requests force expansion — the user must be
	// able to see the PermissionBanner to act on the request.
	const hasPendingPermission =
		!!permissionRequest && !permissionRequest.selectedOptionId;

	// Failed tool calls do NOT auto-expand (CTC-I05). The collapsed summary row
	// flags failure with a highlighted status chip (the "x" icon on an
	// error-background pill), so the user can parse "this failed" at a glance and
	// choose to expand. On expand, the error is surfaced by RawPayloadBlock
	// (rawOutput). Only a pending permission forces expansion, because the user
	// must see the PermissionBanner to act on the request.
	const [isExpanded, setIsExpanded] = useState(hasPendingPermission);

	// If a pending permission shows up after initial render (e.g., during a
	// streaming tool call), open the block so the banner is actionable. Don't
	// auto-collapse it again after the user has interacted — manual state wins.
	const userHasToggledRef = React.useRef(false);
	React.useEffect(() => {
		if (hasPendingPermission && !isExpanded && !userHasToggledRef.current) {
			setIsExpanded(true);
		}
	}, [hasPendingPermission, isExpanded]);

	const toggleExpanded = () => {
		userHasToggledRef.current = true;
		setIsExpanded((prev) => !prev);
	};

	const lineCount = useMemo(() => countLines(content), [content]);

	// Stable id for aria-controls so screen readers announce the
	// toggle as controlling a specific content region.
	const contentId = `agent-tool-call-content-${content.toolCallId}`;
	const ariaLabel = `Tool call${kind ? `: ${kind}` : ""}. ${title || ""}. ${
		isExpanded ? "Expanded." : "Collapsed."
	}`;

	if (!isExpanded) {
		return (
			<button
				type="button"
				className="agent-client-message-tool-call agent-client-message-tool-call-summary"
				aria-expanded={false}
				aria-controls={contentId}
				aria-label={ariaLabel}
				onClick={toggleExpanded}
			>
				<LucideIcon
					name="chevron-right"
					className="agent-client-message-tool-call-summary-caret"
				/>
				{showEmojis && (
					<LucideIcon
						name={getKindIconName(kind)}
						className="agent-client-message-tool-call-icon"
					/>
				)}
				{status !== "completed" && (
					<LucideIcon
						name={status === "failed" ? "x" : "ellipsis"}
						className={`agent-client-message-tool-call-status-icon agent-client-status-${status}`}
					/>
				)}
				<span className="agent-client-message-tool-call-summary-title">
					{title}
				</span>
				<span className="agent-client-message-tool-call-summary-lines">
					{lineCount > 0 ? `${lineCount} lines` : ""}
				</span>
			</button>
		);
	}

	return (
		<div className="agent-client-message-tool-call">
			{/* Header */}
			<div
				className="agent-client-message-tool-call-header agent-client-message-tool-call-header-clickable"
				onClick={toggleExpanded}
				role="button"
				tabIndex={0}
				aria-expanded={true}
				aria-controls={contentId}
				aria-label={ariaLabel}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						toggleExpanded();
					}
				}}
			>
				<div className="agent-client-message-tool-call-title">
					<LucideIcon
						name="chevron-down"
						className="agent-client-message-tool-call-summary-caret"
					/>
					{showEmojis && (
						<LucideIcon
							name={getKindIconName(kind)}
							className="agent-client-message-tool-call-icon"
						/>
					)}
					<span className="agent-client-message-tool-call-title-text">
						{title}
					</span>
					{status !== "completed" && (
						<LucideIcon
							name={status === "failed" ? "x" : "ellipsis"}
							className={`agent-client-message-tool-call-status-icon agent-client-status-${status}`}
						/>
					)}
				</div>
				{kind === "execute" &&
					rawInput &&
					typeof rawInput.command === "string" && (
						<div className="agent-client-message-tool-call-command">
							<code>
								{rawInput.command}
								{Array.isArray(rawInput.args) &&
									rawInput.args.length > 0 &&
									` ${(rawInput.args as string[]).join(" ")}`}
							</code>
						</div>
					)}
				{locations && locations.length > 0 && (
					<div className="agent-client-message-tool-call-locations">
						{locations.map((loc, idx) => (
							<span
								key={idx}
								className="agent-client-message-tool-call-location"
							>
								{toRelativePath(loc.path, vaultPath)}
								{loc.line != null && `:${loc.line}`}
							</span>
						))}
					</div>
				)}
			</div>

			{/* Expanded body — aria-controls target */}
			<div id={contentId} role="region" aria-label={`${title || "Tool call"} content`}>
			{/* Tool call content (diffs, terminal output, etc.) */}
			{toolContent &&
				toolContent.map((item, index) => {
					if (item.type === "terminal") {
						return (
							<TerminalBlock
								key={index}
								terminalId={item.terminalId}
								terminalClient={terminalClient || null}
							/>
						);
					}
					if (item.type === "diff") {
						return (
							<DiffRenderer
								key={index}
								diff={item}
								plugin={plugin}
							/>
						);
					}
					return null;
				})}

			{/* Fallback for generic tool calls (no diff / terminal block):
			    surface the raw input/output payload so the expanded body is
			    never empty when the line-count badge promises content (I03). */}
			{!hasRenderableContent(content) && (
				<RawPayloadBlock
					rawInput={rawInput}
					rawOutput={content.rawOutput}
				/>
			)}

			{/* Permission request section */}
			{permissionRequest && (
				<PermissionBanner
					permissionRequest={{
						...permissionRequest,
						selectedOptionId: selectedOptionId,
					}}
					onApprovePermission={onApprovePermission}
					onOptionSelected={setSelectedOptionId}
				/>
			)}
			</div>
		</div>
	);
});

// ============================================================
// Diff renderer component
// ============================================================
interface DiffRendererProps {
	diff: {
		type: "diff";
		path: string;
		oldText?: string | null;
		newText: string;
	};
	plugin: AgentClientPlugin;
}

/**
 * Represents a single line in a diff view.
 * (Type + computeDiffLines moved to `../utils/toolCallDiff`; see the re-export
 * near the top of this file for the I78 test's import path.)
 */

// Helper function to render word-level diffs
function renderWordDiff(
	wordDiff: { type: "added" | "removed" | "context"; value: string }[],
	lineType: "added" | "removed",
) {
	// Filter parts based on line type to avoid rendering null elements
	const filteredParts = wordDiff.filter((part) => {
		// For removed lines, skip added parts
		if (lineType === "removed" && part.type === "added") {
			return false;
		}
		// For added lines, skip removed parts
		if (lineType === "added" && part.type === "removed") {
			return false;
		}
		return true;
	});

	return (
		<>
			{filteredParts.map((part, partIdx) => {
				if (part.type === "added") {
					return (
						<span
							key={partIdx}
							className="agent-client-diff-word-added"
						>
							{part.value}
						</span>
					);
				} else if (part.type === "removed") {
					return (
						<span
							key={partIdx}
							className="agent-client-diff-word-removed"
						>
							{part.value}
						</span>
					);
				}
				return <span key={partIdx}>{part.value}</span>;
			})}
		</>
	);
}

// Number of context lines to show around changes

function DiffRenderer({ diff }: DiffRendererProps) {
	const diffLines = useMemo(
		() => computeDiffLines(diff),
		[diff.oldText, diff.newText],
	);

	const renderLine = (line: DiffLine, idx: number) => {
		const isHunkHeader =
			line.type === "context" && line.content.startsWith("@@");

		if (isHunkHeader) {
			return (
				<div key={idx} className="agent-client-diff-hunk-header">
					{line.content}
				</div>
			);
		}

		let lineClass = "agent-client-diff-line";

		if (line.type === "added") {
			lineClass += " agent-client-diff-line-added";
		} else if (line.type === "removed") {
			lineClass += " agent-client-diff-line-removed";
		} else {
			lineClass += " agent-client-diff-line-context";
		}

		return (
			<div key={idx} className={lineClass}>
				<span className="agent-client-diff-line-content">
					{line.wordDiff &&
					(line.type === "added" || line.type === "removed")
						? renderWordDiff(line.wordDiff, line.type)
						: line.content}
				</span>
			</div>
		);
	};

	return (
		<div className="agent-client-tool-call-diff">
			{isNewFile(diff) ? (
				<div className="agent-client-diff-line-info">New file</div>
			) : null}
			<div className="agent-client-tool-call-diff-content">
				{diffLines.map((line, idx) => renderLine(line, idx))}
			</div>
		</div>
	);
}

// ============================================================
// Raw payload renderer — fallback for generic tool calls
// ============================================================
interface RawPayloadBlockProps {
	rawInput?: { [k: string]: unknown };
	rawOutput?: { [k: string]: unknown };
}

/**
 * Renders a generic tool call's raw input/output payload as pretty-printed
 * JSON. Used by the expanded body when there is no diff or terminal block to
 * show (e.g. an MCP tool or a subagent "spawn" call), so the body is never
 * empty while the summary badge advertises a line count (I03 phantom body).
 * The same `formatRawPayload` drives `countLines`, keeping badge and body in sync.
 */
function RawPayloadBlock({ rawInput, rawOutput }: RawPayloadBlockProps) {
	// This component only mounts when the tool call is expanded, so the full
	// JSON.stringify is paid on expand — not while collapsed (the badge uses the
	// cheap countJsonLines). Memoize per payload identity so re-renders while
	// expanded don't re-serialize.
	const input = useMemo(() => formatRawPayload(rawInput), [rawInput]);
	const output = useMemo(() => formatRawPayload(rawOutput), [rawOutput]);

	if (!input && !output) return null;

	return (
		<div className="agent-client-tool-call-raw-payload">
			{input && (
				<div className="agent-client-tool-call-raw-section">
					<div className="agent-client-tool-call-raw-label">
						Input
					</div>
					<pre className="agent-client-tool-call-raw-content">
						{input}
					</pre>
				</div>
			)}
			{output && (
				<div className="agent-client-tool-call-raw-section">
					<div className="agent-client-tool-call-raw-label">
						Output
					</div>
					<pre className="agent-client-tool-call-raw-content">
						{output}
					</pre>
				</div>
			)}
		</div>
	);
}
