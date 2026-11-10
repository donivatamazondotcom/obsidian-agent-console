import * as React from "react";
import { useRef, useEffect, useCallback } from "react";
import { setIcon } from "obsidian";
import type { AttachedFile } from "../../types/chat";
import { useTooltip } from "./useTooltip";
import { t } from "../../i18n";

interface AttachmentStripProps {
	files: AttachedFile[];
	onRemove: (id: string) => void;
	/**
	 * A message is queued (`deriveAttachIntake` → `locked`): the remove buttons
	 * stay focusable but do nothing, because the queued message already holds
	 * its own copy of these attachments and would send a removed one anyway
	 * (I319).
	 */
	locked?: boolean;
	/** Return focus to the composer (after removing the last attachment). */
	onFocusComposer?: () => void;
}

/** What the remove button's tooltip (and accessible name) says. */
function removeLabel(file: AttachedFile): string {
	return file.name
		? t("chat.composer.removeAttachment", { name: file.name })
		: t("chat.composer.removeImage");
}

/** Remove button with a stable ref so setIcon runs once on mount. */
function RemoveButton({
	file,
	locked,
	onActivate,
	registerRef,
}: {
	file: AttachedFile;
	locked: boolean;
	onActivate: (id: string) => void;
	registerRef: (id: string, el: HTMLButtonElement | null) => void;
}) {
	const ref = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "x");
	}, []);
	// Icon-only: the label travels as the reason (see deriveTooltipText).
	useTooltip(ref, { visibleLabel: null, reason: removeLabel(file) });
	const setRef = useCallback(
		(el: HTMLButtonElement | null) => {
			ref.current = el;
			registerRef(file.id, el);
		},
		[file.id, registerRef],
	);
	return (
		<button
			ref={setRef}
			className="clickable-icon agent-client-attachment-preview-remove"
			onClick={() => {
				if (!locked) onActivate(file.id);
			}}
			aria-disabled={locked ? "true" : undefined}
			// keep in sync with FOCUS_CLUSTER_ATTR (composer-focus-tracker)
			data-acp-focus-cluster=""
			type="button"
		/>
	);
}

/** File icon with a stable ref so setIcon runs once on mount. */
function FileIcon() {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "file");
	}, []);
	return (
		<span
			ref={ref}
			className="agent-client-attachment-preview-file-icon"
		/>
	);
}

/**
 * Horizontal strip of attachment previews with remove buttons.
 * - Images: show thumbnail
 * - Files: show file icon with filename
 *
 * Owns focus after a keyboard (or mouse) remove: the next remove button, else
 * the previous one, else the composer. Only a remove from THIS strip moves
 * focus — a clear from outside (send, queued flush, agent switch) never does,
 * because only the × handler arms `pendingRemoveRef`.
 */
export function AttachmentStrip({
	files,
	onRemove,
	locked = false,
	onFocusComposer,
}: AttachmentStripProps) {
	// Hooks stay above the empty-list early return so removing the LAST item
	// can still hand focus back to the composer.
	const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
	const pendingRemoveRef = useRef<{ id: string; index: number } | null>(null);

	const registerRef = useCallback(
		(id: string, el: HTMLButtonElement | null) => {
			if (el) buttonRefs.current.set(id, el);
			else buttonRefs.current.delete(id);
		},
		[],
	);

	const handleRemove = useCallback(
		(id: string) => {
			const index = files.findIndex((f) => f.id === id);
			pendingRemoveRef.current = { id, index };
			onRemove(id);
		},
		[files, onRemove],
	);

	useEffect(() => {
		const pending = pendingRemoveRef.current;
		if (pending === null) return;
		// Always consume on the next commit, shrink or not, so a stale marker
		// can't steal focus on some later, unrelated clear.
		pendingRemoveRef.current = null;
		if (files.some((f) => f.id === pending.id)) return;
		const next = files[pending.index] ?? files[pending.index - 1];
		const el = next ? buttonRefs.current.get(next.id) : undefined;
		if (el) el.focus();
		else onFocusComposer?.();
	}, [files, onFocusComposer]);

	if (files.length === 0) return null;

	return (
		<div className="agent-client-attachment-preview-strip">
			{files.map((file) => (
				<div
					key={file.id}
					className="agent-client-attachment-preview-item"
				>
					{file.kind === "image" && file.data ? (
						<img
							src={`data:${file.mimeType};base64,${file.data}`}
							alt={t("chat.messages.attachedImage")}
							className="agent-client-attachment-preview-thumbnail"
						/>
					) : (
						<div className="agent-client-attachment-preview-file">
							<FileIcon />
							<span className="agent-client-attachment-preview-file-name">
								{file.name ?? "file"}
							</span>
						</div>
					)}
					<RemoveButton
						file={file}
						locked={locked}
						onActivate={handleRemove}
						registerRef={registerRef}
					/>
				</div>
			))}
		</div>
	);
}
