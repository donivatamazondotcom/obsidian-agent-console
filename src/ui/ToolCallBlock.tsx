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
import { countLines } from "../utils/toolCallSummary";
import * as Diff from "diff";
// import { MarkdownRenderer } from "./shared/MarkdownRenderer";

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

	// Failed tool calls auto-expand so errors are visible without a click.
	// Manual collapse still wins after the user toggles.
	const isFailed = status === "failed";

	const [isExpanded, setIsExpanded] = useState(
		hasPendingPermission || isFailed,
	);

	// If a pending permission or failure shows up after initial render
	// (e.g., during a streaming tool call), open the block. Don't auto-collapse
	// it again after the user has interacted — manual state wins.
	const userHasToggledRef = React.useRef(false);
	React.useEffect(() => {
		if (
			(hasPendingPermission || isFailed) &&
			!isExpanded &&
			!userHasToggledRef.current
		) {
			setIsExpanded(true);
		}
	}, [hasPendingPermission, isFailed, isExpanded]);

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
 * Represents a single line in a diff view
 * @property type - The type of change: added, removed, or unchanged context
 * @property oldLineNumber - Line number in the old file (undefined for added lines)
 * @property newLineNumber - Line number in the new file (undefined for removed lines)
 * @property content - The text content of the line
 * @property wordDiff - Optional word-level diff for lines that were modified (adjacent removed+added pairs)
 */
export interface DiffLine {
	type: "added" | "removed" | "context";
	oldLineNumber?: number;
	newLineNumber?: number;
	content: string;
	wordDiff?: { type: "added" | "removed" | "context"; value: string }[];
}

/**
 * Check if the diff represents a new file (no old content)
 */
function isNewFile(diff: DiffRendererProps["diff"]): boolean {
	return (
		diff.oldText === null ||
		diff.oldText === undefined ||
		diff.oldText === ""
	);
}

// Helper function to map diff parts to our internal format
function mapDiffParts(
	parts: Diff.Change[],
): { type: "added" | "removed" | "context"; value: string }[] {
	return parts.map((part) => ({
		type: part.added ? "added" : part.removed ? "removed" : "context",
		value: part.value,
	}));
}

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
const CONTEXT_LINES = 3;

/**
 * Compute the unified diff lines (with optional word-level diffs) for a file edit.
 * Extracted from DiffRenderer's memo so the diff-pairing logic can be unit-tested
 * directly (see I78 — word-level diff skipped when the payload lacks a trailing newline).
 */
export function computeDiffLines(diff: DiffRendererProps["diff"]): DiffLine[] {
	if (isNewFile(diff)) {
		// New file - all lines are added
		const lines = diff.newText.split("\n");
		return lines.map(
			(line, idx): DiffLine => ({
				type: "added",
				newLineNumber: idx + 1,
				content: line,
			}),
		);
	}

	// Use structuredPatch to get a proper unified diff
	// At this point, oldText is guaranteed to be a non-empty string (checked by isNewFile)
	const oldText = diff.oldText || "";
	const patch = Diff.structuredPatch(
		"old",
		"new",
		oldText,
		diff.newText,
		"",
		"",
		{ context: CONTEXT_LINES },
	);

	const result: DiffLine[] = [];
	let oldLineNum = 0;
	let newLineNum = 0;

	// Process hunks
	for (const hunk of patch.hunks) {
		// Add hunk header only if there are multiple hunks
		// (helps users see gaps between different sections of changes)
		if (patch.hunks.length > 1) {
			result.push({
				type: "context",
				content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
			});
		}

		oldLineNum = hunk.oldStart;
		newLineNum = hunk.newStart;

		for (const line of hunk.lines) {
			const marker = line[0];
			const content = line.substring(1);

			// `structuredPatch` emits a "No newline at end of file" marker
			// line (its marker char is a backslash) whenever a payload lacks
			// a trailing newline. The marker carries no display value here,
			// and left in `result` it sits between a removed and an added
			// line — breaking the removed→added adjacency the word-diff
			// pairing below relies on (see I78). Drop it.
			if (marker === "\\") {
				continue;
			}

			if (marker === "+") {
				result.push({
					type: "added",
					newLineNumber: newLineNum++,
					content,
				});
			} else if (marker === "-") {
				result.push({
					type: "removed",
					oldLineNumber: oldLineNum++,
					content,
				});
			} else {
				// Context line (unchanged)
				result.push({
					type: "context",
					oldLineNumber: oldLineNum++,
					newLineNumber: newLineNum++,
					content,
				});
			}
		}
	}

	// Add word-level diff for modified lines that are adjacent
	for (let i = 0; i < result.length - 1; i++) {
		const current = result[i];
		const next = result[i + 1];

		// If we have a removed line followed by an added line, compute word diff
		if (current.type === "removed" && next.type === "added") {
			const wordDiff = Diff.diffWords(current.content, next.content);
			const mappedDiff = mapDiffParts(wordDiff);
			current.wordDiff = mappedDiff;
			next.wordDiff = mappedDiff;
		}
	}

	return result;
}

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
