/**
 * usePicker — the one suggestion-picker state machine, parameterized by a
 * {@link PickerSource}. Replaces the three hand-rolled state machines that used
 * to live in `useSuggestions` (mentions / slash / quick-prompts): each is now a
 * `usePicker(source)` instance whose variance is entirely in its source config.
 *
 * The hook owns the shared mechanics — items / selection / open state, the
 * navigation policy dispatch, and the stateful dismiss guard — while every
 * source-specific decision (trigger detection, fetch, projection, select-text,
 * nav policy, instructions, create row) is read from the source. Async fetch
 * (mention vault search) and sync fetch (slash filter, quick-prompt rank) are
 * both handled: a Promise is awaited, an array is applied synchronously, so the
 * sync sources still update state in the same tick.
 *
 * Spec: [[Unified Picker Control]] (Tier 3 — one picker state machine).
 */
import { useState, useCallback, useMemo, useRef } from "react";
import { wrapSelectionIndex } from "../services/quick-prompts-logic";
import type {
	PickerSource,
	PickerState,
	PickerTriggerContext,
	PickerCreateRow,
} from "../types/picker";

/**
 * Drive a single suggestion source. Returns the normalized {@link PickerState}
 * the consumer adapts into its exposed shape.
 *
 * @typeParam T   The source's domain item.
 * @typeParam Ctx The source's trigger context.
 */
export function usePicker<T, Ctx extends PickerTriggerContext>(
	source: PickerSource<T, Ctx>,
): PickerState<T, Ctx> {
	const [items, setItems] = useState<T[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [context, setContext] = useState<Ctx | null>(null);
	const [createRow, setCreateRow] = useState<PickerCreateRow | null>(null);

	// Dismiss guard: when the source declares `dismissGuard`, Escape remembers
	// the dismissed trigger's `start` so the picker stays closed for that run
	// (cleared when a different trigger becomes active or the caret leaves it).
	// Inert for sources that don't declare the guard.
	const dismissedStartRef = useRef<number | null>(null);

	const isOpen =
		(items.length > 0 || createRow !== null) && context !== null;

	const clear = useCallback(() => {
		setItems([]);
		setSelectedIndex(0);
		setContext(null);
		setCreateRow(null);
	}, []);

	const apply = useCallback(
		(fetched: T[], ctx: Ctx, input: string) => {
			setItems(fetched);
			setSelectedIndex(0);
			setContext(ctx);
			setCreateRow(
				source.createRow
					? source.createRow(ctx, fetched, input)
					: null,
			);
		},
		[source],
	);

	const updateSuggestions = useCallback(
		(input: string, caret: number): void | Promise<void> => {
			const ctx = source.detectTrigger(input, caret);
			if (!ctx) {
				// Caret left the trigger — clear any guard so a future trigger
				// can open.
				if (source.dismissGuard) dismissedStartRef.current = null;
				clear();
				return;
			}
			if (source.dismissGuard) {
				// Stay closed if this exact run was dismissed via Esc.
				if (dismissedStartRef.current === ctx.start) {
					clear();
					return;
				}
				// A different run than the dismissed one — clear the guard.
				dismissedStartRef.current = null;
			}
			const fetched = source.fetchItems(ctx);
			if (fetched instanceof Promise) {
				return fetched.then((resolved) => apply(resolved, ctx, input));
			}
			apply(fetched, ctx, input);
		},
		[source, clear, apply],
	);

	const selectSuggestion = useCallback(
		(input: string, item?: T): string => {
			if (!context) return input;
			const newText = source.onSelect(input, context, item as T);
			clear();
			return newText;
		},
		[source, context, clear],
	);

	const navigate = useCallback(
		(direction: "up" | "down") => {
			if (!isOpen) return;
			// The create row (when present) is the always-last selectable row.
			const maxIndex = items.length - 1 + (createRow !== null ? 1 : 0);
			setSelectedIndex((prev) => {
				if (source.navPolicy === "wrap") {
					return wrapSelectionIndex(prev, maxIndex, direction);
				}
				return direction === "down"
					? Math.min(prev + 1, maxIndex)
					: Math.max(prev - 1, 0);
			});
		},
		[isOpen, items.length, createRow, source.navPolicy],
	);

	const close = useCallback(() => {
		dismissedStartRef.current = null;
		clear();
	}, [clear]);

	const dismiss = useCallback(() => {
		if (source.dismissGuard) {
			// Remember the current run's start so it stays closed, then clear
			// the open dropdown (do NOT reset the ref — only close() does that).
			dismissedStartRef.current = context?.start ?? null;
			clear();
		} else {
			close();
		}
	}, [source.dismissGuard, context, clear, close]);

	return useMemo(
		() => ({
			items,
			context,
			selectedIndex,
			isOpen,
			createRow,
			updateSuggestions,
			selectSuggestion,
			navigate,
			close,
			dismiss,
		}),
		[
			items,
			context,
			selectedIndex,
			isOpen,
			createRow,
			updateSuggestions,
			selectSuggestion,
			navigate,
			close,
			dismiss,
		],
	);
}
