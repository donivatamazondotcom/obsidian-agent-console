import { useEffect, useRef } from "react";

/**
 * Narrow port interface for vault event subscription.
 * Satisfied by wrapping Obsidian's vault.on('rename'/'delete').
 */
export interface VaultEventSource {
	onRename: (cb: (oldPath: string, newPath: string) => void) => () => void;
	onDelete: (cb: (path: string) => void) => () => void;
}

export interface UseContextVaultEventsInput {
	vault: VaultEventSource;
	crystallizedPaths: Set<string>;
	onRename: (oldPath: string, newPath: string) => void;
	onRemove: (path: string) => void;
}

/**
 * Subscribes to vault rename/delete events and updates context notes
 * when a crystallized note is affected.
 */
export function useContextVaultEvents({
	vault,
	crystallizedPaths,
	onRename,
	onRemove,
}: UseContextVaultEventsInput): void {
	const pathsRef = useRef(crystallizedPaths);
	pathsRef.current = crystallizedPaths;

	const onRenameRef = useRef(onRename);
	onRenameRef.current = onRename;

	const onRemoveRef = useRef(onRemove);
	onRemoveRef.current = onRemove;

	useEffect(() => {
		const unsubRename = vault.onRename((oldPath, newPath) => {
			if (pathsRef.current.has(oldPath)) {
				onRenameRef.current(oldPath, newPath);
			}
		});

		const unsubDelete = vault.onDelete((path) => {
			if (pathsRef.current.has(path)) {
				onRemoveRef.current(path);
			}
		});

		return () => {
			unsubRename();
			unsubDelete();
		};
	}, [vault]);
}

// ============================================================================
// extractMentionedPaths — pure utility
// ============================================================================

/**
 * Extract vault paths from @[[...]] mentions in message text.
 * Uses a resolver function to map note names to vault-relative paths.
 * Returns deduplicated paths in left-to-right order of appearance.
 */
export function extractMentionedPaths(
	text: string,
	resolver: (noteName: string) => string | null,
): string[] {
	const regex = /@\[\[([^\]]+)\]\]/g;
	const paths: string[] = [];
	const seen = new Set<string>();

	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const name = match[1];
		const path = resolver(name);
		if (path && !seen.has(path)) {
			seen.add(path);
			paths.push(path);
		}
	}

	return paths;
}
