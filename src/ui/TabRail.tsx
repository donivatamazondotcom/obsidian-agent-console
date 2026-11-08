/**
 * Vertical tab rail ([[Agent Console Vertical Tab Rail]]).
 *
 * Replaces the top tab strip when Settings › Tabs › Tab display is Vertical.
 * A 32px column on the right edge of the chat view: `+` and `˅` at the top,
 * then one key per tab showing only its status icon. Hovering a key shows a
 * piano-key flyout with the name and status; drag the handle on the inner
 * edge to widen the rail and see names.
 *
 * Reuses the strip's pieces rather than forking them: the state icons
 * (tab-state-icon), the context menu and tab list (tab-menus), and the
 * keyboard resolver (deriveTabKeyTarget, vertical). Decisions live in pure
 * resolvers: width (tab-rail-width), flyout timing (tab-rail-hover) and
 * scroll (tab-rail-scroll).
 *
 * Width state lives here, not in ChatView: ChatView's panels aren't memoized,
 * so a width subscription there would re-render every chat on each sidebar
 * resize. Writes go through the settings store (single writer), only at
 * commit points: drag release, toggle, and debounced keyboard steps.
 */

import * as React from "react";
const {
	useRef,
	useEffect,
	useLayoutEffect,
	useCallback,
	useState,
	useId,
	useSyncExternalStore,
} = React;
import { setIcon } from "obsidian";
import type { TabInfo } from "../types/tab";
import type { TabBarProps } from "./TabBar";
import { TabStateIcon, stateLabel } from "./tab-state-icon";
import { showTabContextMenu, showTabListMenu } from "./tab-menus";
import { isKeyboardFocus } from "./keyboard-focus";
import { holdNextActivationRefocus } from "./composer-focus";
import { deriveTabKeyTarget } from "../resolvers/tab-keyboard-nav";
import {
	resolveRailWidth,
	maxNamedWidth,
	nextRailWidthFromKey,
	toggleRailWidth,
	showsCloseButton,
	RAIL_ICON_WIDTH,
	RAIL_CLOSE_BUTTON_PX,
	RAIL_CLOSE_INSET_PX,
	RAIL_CLOSE_FADE_PX,
	type RailWidth,
} from "../resolvers/tab-rail-width";
import {
	nextRailHover,
	flyoutKey,
	shouldShowFlyout,
	isLabelCut,
	type RailHoverEvent,
	type RailHoverState,
} from "../resolvers/tab-rail-hover";
import { deriveRailScrollTop } from "../resolvers/tab-rail-scroll";
import { t } from "../i18n";

/** The slice of plugin.settingsService the rail needs. */
export interface RailSettingsStore {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => { tabRailWidth: number; tabRailNamedWidth: number };
	updateSettings: (u: {
		tabRailWidth: number;
		tabRailNamedWidth: number;
	}) => unknown;
}

export interface TabRailProps extends TabBarProps {
	settingsStore: RailSettingsStore;
}

/** A press on the handle becomes a drag once the pointer moves this far. */
const DRAG_THRESHOLD_PX = 3;
/** Keyboard resizing writes once the keys go quiet for this long. */
const KEY_COMMIT_DEBOUNCE_MS = 300;

const isHoverPointer = (e: React.PointerEvent) =>
	e.pointerType === "mouse" || e.pointerType === "pen";

/** What a commit writes: names keep both keys in step; icons keep the named width. */
function commitFor(width: number, namedStored: number) {
	return width >= 60
		? { tabRailWidth: width, tabRailNamedWidth: width }
		: { tabRailWidth: RAIL_ICON_WIDTH, tabRailNamedWidth: namedStored };
}

interface DragState {
	pointerId: number;
	startX: number;
	startWidth: number;
	active: boolean;
	lastX: number;
	/** A preview frame is queued (a frame can run before its id is stored, so the id alone can't say). */
	framePending: boolean;
	frameId: number | null;
	/** The handle's own window: a popout's frame is requested and cancelled there. */
	win: Window;
	mode: RailWidth["mode"];
	/** Whether the live width shows the close button (I301): a flip re-renders, like a mode flip. */
	closeShown: boolean;
}

export function TabRail(props: TabRailProps) {
	const {
		tabs,
		activeTabId,
		onSelectTab,
		onAddTab,
		onCloseTab,
		onCloseOtherTabs,
		onCloseTabsToRight,
		onRenameTab,
		onAiRenameTab,
		aiRenamingTabIds,
		getAiRenameAffordance,
		onAddTabWithAgent,
		onRegisterShowTabList,
		settingsStore,
	} = props;

	const uid = useId();
	const railRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const flyoutRef = useRef<HTMLDivElement>(null);
	const addBtnRef = useRef<HTMLButtonElement>(null);
	const chevronRef = useRef<HTMLButtonElement>(null);
	const handleRef = useRef<HTMLDivElement>(null);

	// ---------------------------------------------------------------- width
	const stored = useSyncExternalStore(
		settingsStore.subscribe,
		() => settingsStore.getSnapshot().tabRailWidth,
	);
	const namedStored = useSyncExternalStore(
		settingsStore.subscribe,
		() => settingsStore.getSnapshot().tabRailNamedWidth,
	);
	const [viewWidth, setViewWidth] = useState<number>(Number.NaN);
	/** Bumped on any view resize (height too), to keep the active key in view. */
	const [resizeTick, setResizeTick] = useState(0);
	/** Width chosen by a drag mode flip or a pending keyboard step. */
	const [override, setOverride] = useState<number | null>(null);
	const requested = override ?? stored;
	const resolved = resolveRailWidth({ requested, viewWidth });
	const named = resolved.mode === "names";
	/** Hover-only × on named keys at 100 px and wider (I301). */
	const closeShown = named && showsCloseButton(resolved.width);

	// Latest values for event handlers and cleanups.
	const live = useRef({
		stored,
		namedStored,
		viewWidth,
		resolved,
		requested,
	});
	live.current = { stored, namedStored, viewWidth, resolved, requested };

	const measure = useCallback(() => {
		const host = railRef.current?.parentElement;
		if (!host) return;
		const w = host.getBoundingClientRect().width;
		const cur = live.current;
		const next = resolveRailWidth({
			requested: cur.requested,
			viewWidth: w,
		});
		const sameWidth =
			next.mode === cur.resolved.mode &&
			next.width === cur.resolved.width;
		const sameMax =
			Math.min(260, maxNamedWidth(w)) ===
			Math.min(260, maxNamedWidth(cur.viewWidth));
		if (!sameWidth || !sameMax || !Number.isFinite(cur.viewWidth)) {
			setViewWidth(w);
		}
	}, []);

	// Before the first paint: a stored named width renders names at once.
	useLayoutEffect(() => {
		measure();
	}, [measure]);

	useEffect(() => {
		const host = railRef.current?.parentElement;
		if (!host || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			measure();
			setResizeTick((n) => n + 1);
		});
		observer.observe(host);
		return () => observer.disconnect();
	}, [measure]);

	const commit = useCallback(
		(width: number) => {
			void settingsStore.updateSettings(
				commitFor(width, live.current.namedStored),
			);
		},
		[settingsStore],
	);

	// Keyboard steps: resize at once, write once the keys go quiet, and write
	// any pending step on unmount (setting switched, last tab closed, …).
	const pendingKey = useRef<{ width: number; timer: number } | null>(null);
	const flushPendingKey = useCallback(() => {
		const p = pendingKey.current;
		if (!p) return false;
		window.clearTimeout(p.timer);
		pendingKey.current = null;
		commit(p.width);
		return true;
	}, [commit]);

	useEffect(
		() => () => {
			flushPendingKey();
		},
		[flushPendingKey],
	);

	// ---------------------------------------------------------------- hover
	const [hover, setHover] = useState<RailHoverState>({ kind: "cold" });
	const hoverRef = useRef(hover);
	const timers = useRef<{ warm: number | null; cool: number | null }>({
		warm: null,
		cool: null,
	});
	const [repositionTick, setRepositionTick] = useState(0);
	const pointerInside = useRef(false);

	const dispatch = useCallback((ev: RailHoverEvent) => {
		const r = nextRailHover(hoverRef.current, ev);
		hoverRef.current = r.state;
		setHover(r.state);
		for (const fx of r.effects) {
			switch (fx.type) {
				case "startWarm":
					if (timers.current.warm !== null)
						window.clearTimeout(timers.current.warm);
					timers.current.warm = window.setTimeout(() => {
						timers.current.warm = null;
						dispatch({ type: "warmElapsed" });
					}, fx.ms);
					break;
				case "cancelWarm":
					if (timers.current.warm !== null)
						window.clearTimeout(timers.current.warm);
					timers.current.warm = null;
					break;
				case "startCool":
					if (timers.current.cool !== null)
						window.clearTimeout(timers.current.cool);
					timers.current.cool = window.setTimeout(() => {
						timers.current.cool = null;
						dispatch({ type: "coolElapsed" });
					}, fx.ms);
					break;
				case "cancelCool":
					if (timers.current.cool !== null)
						window.clearTimeout(timers.current.cool);
					timers.current.cool = null;
					break;
				case "reposition":
					setRepositionTick((n) => n + 1);
					break;
			}
		}
	}, []);

	useEffect(
		() => () => {
			if (timers.current.warm !== null)
				window.clearTimeout(timers.current.warm);
			if (timers.current.cool !== null)
				window.clearTimeout(timers.current.cool);
		},
		[],
	);

	// A closed tab can't keep a flyout.
	const tabIdsKey = tabs.map((tb) => tb.tabId).join("\u0000");
	useEffect(() => {
		dispatch({ type: "keysChanged", keys: tabIdsKey.split("\u0000") });
	}, [tabIdsKey, dispatch]);

	const shownId = flyoutKey(hover);
	const shownVia = hover.kind === "showing" ? hover.via : null;
	const shownTab: TabInfo | undefined = shownId
		? tabs.find((tb) => tb.tabId === shownId)
		: undefined;
	const [truncated, setTruncated] = useState(false);

	// Position the flyout next to its key, and decide (names mode) whether the
	// name is cut off. Layout reads only while a flyout is showing.
	useLayoutEffect(() => {
		if (!shownId) return;
		const rail = railRef.current;
		const fly = flyoutRef.current;
		const key = Array.from(
			rail?.querySelectorAll<HTMLElement>(".agent-client-tab-rail-key") ??
				[],
		).find((el) => el.dataset.tabId === shownId);
		if (!rail || !fly || !key) return;
		const label = key.querySelector<HTMLElement>(
			".agent-client-tab-rail-key-label",
		);
		setTruncated(
			label
				? isLabelCut({
						scrollWidth: label.scrollWidth,
						clientWidth: label.clientWidth,
						via: shownVia ?? "focus",
						width: resolved.width,
					})
				: false,
		);
		const k = key.getBoundingClientRect();
		const r = rail.getBoundingClientRect();
		fly.style.setProperty(
			"--ac-rail-flyout-top",
			`${k.top - r.top + k.height / 2}px`,
		);
	}, [shownId, shownVia, repositionTick, resolved.width]);

	const flyoutVisible =
		shownTab !== undefined &&
		shouldShowFlyout({ mode: resolved.mode, truncated });

	// ---------------------------------------------------------------- drag
	const drag = useRef<DragState | null>(null);

	const applyLiveWidth = useCallback((r: RailWidth) => {
		const rail = railRef.current;
		if (!rail) return;
		rail.style.setProperty("--ac-rail-width", `${r.width}px`);
		rail.querySelector(".agent-client-tab-rail-handle")?.setAttribute(
			"aria-valuenow",
			String(r.width),
		);
	}, []);

	const endDrag = useCallback(
		(kind: "commit" | "revert", clientX?: number) => {
			const d = drag.current;
			if (!d) return;
			drag.current = null;
			if (d.framePending && d.frameId !== null) {
				d.win.cancelAnimationFrame(d.frameId);
			}
			if (!d.active || kind === "revert") {
				setOverride(null);
				applyLiveWidth(
					resolveRailWidth({
						requested: live.current.stored,
						viewWidth: live.current.viewWidth,
					}),
				);
				return;
			}
			const x = clientX ?? d.lastX;
			const r = resolveRailWidth({
				requested: d.startWidth + (d.startX - x),
				viewWidth: live.current.viewWidth,
			});
			setOverride(null);
			commit(r.width);
		},
		[applyLiveWidth, commit],
	);

	const onHandlePointerDown = useCallback(
		(e: PointerEvent) => {
			if (e.button !== 0) return;
			flushPendingKey();
			drag.current = {
				pointerId: e.pointerId,
				startX: e.clientX,
				startWidth: live.current.resolved.width,
				active: false,
				lastX: e.clientX,
				framePending: false,
				frameId: null,
				win:
					(e.currentTarget as HTMLElement | null)?.ownerDocument
						.defaultView ?? window,
				mode: live.current.resolved.mode,
				closeShown: showsCloseButton(live.current.resolved.width),
			};
			try {
				(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(
					e.pointerId,
				);
			} catch {
				// No capture (old runtime): the drag still works while over the handle.
			}
		},
		[flushPendingKey],
	);

	const onHandlePointerMove = useCallback(
		(e: PointerEvent) => {
			const d = drag.current;
			if (!d || e.pointerId !== d.pointerId) return;
			d.lastX = e.clientX;
			if (!d.active) {
				if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return;
				d.active = true;
				dispatch({ type: "dragStarted" });
			}
			if (d.framePending) return;
			d.framePending = true;
			d.frameId = d.win.requestAnimationFrame(() => {
				const cur = drag.current;
				if (!cur) return;
				cur.framePending = false;
				const r = resolveRailWidth({
					requested: cur.startWidth + (cur.startX - cur.lastX),
					viewWidth: live.current.viewWidth,
				});
				// One render per flip of the mode or the close button (one call
				// when both flip in the same frame, e.g. 160 → 40), never per frame.
				const closeShown = showsCloseButton(r.width);
				if (r.mode !== cur.mode || closeShown !== cur.closeShown) {
					cur.mode = r.mode;
					cur.closeShown = closeShown;
					setOverride(r.width);
				}
				applyLiveWidth(r);
			});
		},
		[applyLiveWidth, dispatch],
	);

	const onHandlePointerUp = useCallback(
		(e: PointerEvent) => {
			const d = drag.current;
			if (!d || e.pointerId !== d.pointerId) return;
			endDrag("commit", e.clientX);
		},
		[endDrag],
	);

	const onHandleCancel = useCallback(() => endDrag("revert"), [endDrag]);

	const toggle = useCallback(() => {
		const pending = pendingKey.current;
		if (pending) {
			window.clearTimeout(pending.timer);
			pendingKey.current = null;
		}
		const cur = live.current;
		const base = pending ? commitFor(pending.width, cur.namedStored) : null;
		setOverride(null);
		void settingsStore.updateSettings(
			toggleRailWidth({
				stored: base ? base.tabRailWidth : cur.stored,
				namedWidth: base ? base.tabRailNamedWidth : cur.namedStored,
				viewWidth: cur.viewWidth,
			}),
		);
	}, [settingsStore]);

	const onHandleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				toggle();
				return;
			}
			const cur = live.current;
			const next = nextRailWidthFromKey({
				rendered: cur.resolved.width,
				key: e.key,
				viewWidth: cur.viewWidth,
			});
			if (next.kind !== "set") return;
			e.preventDefault();
			setOverride(next.width);
			if (pendingKey.current)
				window.clearTimeout(pendingKey.current.timer);
			pendingKey.current = {
				width: next.width,
				timer: window.setTimeout(() => {
					const p = pendingKey.current;
					pendingKey.current = null;
					if (!p) return;
					commit(p.width);
					setOverride(null);
				}, KEY_COMMIT_DEBOUNCE_MS),
			};
		},
		[toggle, commit],
	);

	// Escape: dismiss the flyout, or revert a drag. Listens on the rail's own
	// document (a popout listens in its own window) and never cancels the
	// event, so the composer's and Obsidian's Escape still run.
	useEffect(() => {
		const doc = railRef.current?.ownerDocument;
		if (!doc) return;
		const onKey = (ev: KeyboardEvent) => {
			if (ev.key !== "Escape") return;
			if (drag.current) endDrag("revert");
			if (hoverRef.current.kind === "showing")
				dispatch({ type: "escape" });
		};
		doc.addEventListener("keydown", onKey);
		return () => doc.removeEventListener("keydown", onKey);
	}, [dispatch, endDrag]);

	// The handle's listeners are attached natively: it is a focusable
	// role="separator" (the WAI-ARIA window splitter, an interactive widget),
	// which jsx-a11y classes as static. Native listeners keep the role and
	// avoid a lint disable the store's review bot can't resolve.
	useEffect(() => {
		const el = handleRef.current;
		if (!el) return;
		const onLost = () => {
			if (drag.current) endDrag("revert");
		};
		// A press on the handle must not take focus from the composer (the next
		// arrow keys would resize the rail) or start a text selection. Keyboard
		// Tab focus and dblclick are unaffected.
		const onMouseDown = (ev: MouseEvent) => {
			if (ev.button === 0) ev.preventDefault();
		};
		el.addEventListener("mousedown", onMouseDown);
		el.addEventListener("pointerdown", onHandlePointerDown);
		el.addEventListener("pointermove", onHandlePointerMove);
		el.addEventListener("pointerup", onHandlePointerUp);
		el.addEventListener("pointercancel", onHandleCancel);
		el.addEventListener("lostpointercapture", onLost);
		el.addEventListener("dblclick", toggle);
		el.addEventListener("keydown", onHandleKeyDown);
		return () => {
			el.removeEventListener("mousedown", onMouseDown);
			el.removeEventListener("pointerdown", onHandlePointerDown);
			el.removeEventListener("pointermove", onHandlePointerMove);
			el.removeEventListener("pointerup", onHandlePointerUp);
			el.removeEventListener("pointercancel", onHandleCancel);
			el.removeEventListener("lostpointercapture", onLost);
			el.removeEventListener("dblclick", toggle);
			el.removeEventListener("keydown", onHandleKeyDown);
		};
	}, [
		onHandlePointerDown,
		onHandlePointerMove,
		onHandlePointerUp,
		onHandleCancel,
		toggle,
		onHandleKeyDown,
		endDrag,
	]);

	// ---------------------------------------------------------------- toolbar
	useEffect(() => {
		if (addBtnRef.current) setIcon(addBtnRef.current, "plus");
		if (chevronRef.current) setIcon(chevronRef.current, "chevron-down");
	}, []);

	const showTabList = useCallback(() => {
		chevronRef.current?.click();
	}, []);
	useEffect(() => {
		onRegisterShowTabList?.(showTabList);
	}, [onRegisterShowTabList, showTabList]);

	const onChevronClick = useCallback(
		(e: React.MouseEvent) => {
			dispatch({ type: "menuOpened" });
			showTabListMenu(e, { tabs, activeTabId, onSelectTab });
		},
		[dispatch, tabs, activeTabId, onSelectTab],
	);

	const onKeyContextMenu = useCallback(
		(e: React.MouseEvent, tab: TabInfo) => {
			dispatch({ type: "menuOpened" });
			showTabContextMenu(e, tab, {
				tabs,
				onCloseTab,
				onCloseOtherTabs,
				onCloseTabsToRight,
				onRenameTab,
				onAiRenameTab,
				aiRenamingTabIds,
				getAiRenameAffordance,
				orientation: "vertical",
			});
		},
		[
			dispatch,
			tabs,
			onCloseTab,
			onCloseOtherTabs,
			onCloseTabsToRight,
			onRenameTab,
			onAiRenameTab,
			aiRenamingTabIds,
			getAiRenameAffordance,
		],
	);

	// ---------------------------------------------------------------- keys
	/**
	 * Delete/Backspace close (I301): the closed key's index, so focus can land on
	 * the key now at that position once the list re-renders.
	 */
	const pendingCloseFocus = useRef<{ index: number; tabId: string } | null>(
		null,
	);
	const onKeyNav = useCallback(
		(index: number) => (e: React.KeyboardEvent) => {
			const target = deriveTabKeyTarget({
				key: e.key,
				index,
				count: tabs.length,
				orientation: "vertical",
				repeat: e.repeat,
				hasModifier: e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
			});
			if (target.kind === "close") {
				const tab = tabs[index];
				if (!tab) return;
				e.preventDefault();
				pendingCloseFocus.current = { index, tabId: tab.tabId };
				// Closing the active key activates its neighbor, whose composer
				// would take focus a tick later; keep it on the rail (B1).
				if (tab.tabId === activeTabId && tabs.length > 1) {
					holdNextActivationRefocus(
						listRef.current?.ownerDocument ?? document,
					);
				}
				onCloseTab(tab.tabId);
				return;
			}
			if (target.kind !== "focus") return;
			e.preventDefault();
			const keys =
				listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
			keys?.[target.index]?.focus();
		},
		[tabs, activeTabId, onCloseTab],
	);

	// After a Delete close, focus the key now at the closed key's position (its
	// neighbor, active or not), or the last key. Not "the new active key":
	// activation is manual, so that could be an unrelated tab, and a second
	// Delete would close the chat the user is working in. Cleared on every run.
	useLayoutEffect(() => {
		const pending = pendingCloseFocus.current;
		pendingCloseFocus.current = null;
		if (!pending) return;
		const ids = tabIdsKey.split("\u0000");
		if (tabIdsKey !== "" && ids.includes(pending.tabId)) return;
		const keys =
			listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
		if (!keys || keys.length === 0) return;
		keys[Math.min(pending.index, keys.length - 1)]?.focus();
	}, [tabIdsKey]);

	// Keep the active key in view, scrolling only the list.
	useEffect(() => {
		const list = listRef.current;
		const key = list?.querySelector<HTMLElement>(
			".agent-client-tab-rail-key.is-active",
		);
		if (!list || !key) return;
		const l = list.getBoundingClientRect();
		const k = key.getBoundingClientRect();
		const next = deriveRailScrollTop({
			listTop: l.top,
			listBottom: l.bottom,
			keyTop: k.top,
			keyBottom: k.bottom,
			scrollTop: list.scrollTop,
		});
		if (next !== list.scrollTop) list.scrollTop = next;
	}, [activeTabId, viewWidth, resizeTick]);

	const hasActiveTab = tabs.some((tb) => tb.tabId === activeTabId);
	const maxNamed = Math.max(RAIL_ICON_WIDTH, maxNamedWidth(viewWidth));

	return (
		<div
			ref={railRef}
			className={`agent-client-tab-rail ${named ? "is-names" : "is-icons"}`}
			style={
				{
					"--ac-rail-width": `${resolved.width}px`,
					"--ac-rail-close-size": `${RAIL_CLOSE_BUTTON_PX}px`,
					"--ac-rail-close-inset": `${RAIL_CLOSE_INSET_PX}px`,
					"--ac-rail-close-fade": `${RAIL_CLOSE_FADE_PX}px`,
				} as React.CSSProperties
			}
			onPointerEnter={(e) => {
				if (!isHoverPointer(e)) return;
				pointerInside.current = true;
				dispatch({ type: "pointerEnterRail" });
			}}
			onPointerLeave={(e) => {
				if (!isHoverPointer(e)) return;
				pointerInside.current = false;
				dispatch({ type: "pointerLeaveRail" });
			}}
		>
			<div
				ref={handleRef}
				className="agent-client-tab-rail-handle"
				role="separator"
				aria-orientation="vertical"
				tabIndex={0}
				aria-labelledby={`${uid}-handle`}
				aria-valuenow={resolved.width}
				aria-valuemin={RAIL_ICON_WIDTH}
				aria-valuemax={maxNamed}
				aria-valuetext={
					named
						? t("chat.tabRail.showingNames")
						: t("chat.tabRail.iconsOnly")
				}
			>
				<span
					id={`${uid}-handle`}
					className="agent-client-visually-hidden"
				>
					{t("chat.tabRail.resize")}
				</span>
			</div>
			<div className="agent-client-tab-rail-toolbar">
				<button
					ref={addBtnRef}
					type="button"
					className="clickable-icon agent-client-tab-bar-add"
					aria-label={t("chat.tabBar.newSessionTab")}
					onClick={onAddTab}
					onContextMenu={onAddTabWithAgent}
				/>
				<button
					ref={chevronRef}
					type="button"
					className="clickable-icon agent-client-tab-bar-chevron"
					aria-label={t("chat.tabBar.tabList")}
					onClick={onChevronClick}
				/>
			</div>
			{/* Named by a hidden span, not aria-label: Obsidian shows any
			    aria-label as a hover tooltip, which popped "Tab list" over
			    the whole rail (smoke H2). */}
			<span id={`${uid}-list`} className="agent-client-visually-hidden">
				{t("chat.tabBar.tabList")}
			</span>
			<div
				ref={listRef}
				className="agent-client-tab-rail-list"
				role="tablist"
				aria-orientation="vertical"
				aria-labelledby={`${uid}-list`}
				onScroll={() => dispatch({ type: "listScrolled" })}
			>
				{tabs.map((tab, index) => {
					const isActive = tab.tabId === activeTabId;
					const renaming = aiRenamingTabIds?.has(tab.tabId) ?? false;
					const status = stateLabel(tab.state);
					const nameId = `${uid}-name-${index}`;
					return (
						<div
							key={tab.tabId}
							className="agent-client-tab-rail-row"
							role="presentation"
							onPointerEnter={(e) => {
								if (isHoverPointer(e)) {
									dispatch({
										type: "pointerEnterKey",
										key: tab.tabId,
									});
								}
							}}
							onPointerLeave={(e) => {
								if (isHoverPointer(e))
									dispatch({ type: "pointerLeaveKey" });
							}}
						>
						<button
							type="button"
							role="tab"
							data-tab-id={tab.tabId}
							className={`agent-client-tab-rail-key${isActive ? " is-active" : ""}`}
							aria-selected={isActive}
							aria-labelledby={nameId}
							tabIndex={
								isActive || (!hasActiveTab && index === 0)
									? 0
									: -1
							}
							onClick={() => onSelectTab(tab.tabId)}
							onMouseDown={(e) => {
								if (e.button === 1) {
									e.preventDefault();
									onCloseTab(tab.tabId);
								}
							}}
							onContextMenu={(e) => onKeyContextMenu(e, tab)}
							onKeyDown={onKeyNav(index)}
							onFocus={(e) => {
								if (isKeyboardFocus(e.currentTarget)) {
									dispatch({
										type: "focusKey",
										key: tab.tabId,
									});
								}
							}}
							onBlur={() =>
								dispatch({
									type: "blurKey",
									pointerInside: pointerInside.current,
								})
							}
						>
							<TabStateIcon state={tab.state} decorative />
							{named && (
								<span className="agent-client-tab-rail-key-label">
									{tab.label}
								</span>
							)}
							{named && renaming && <RailRenamingIcon />}
							<span
								id={nameId}
								className="agent-client-visually-hidden"
							>
								{renaming
									? t("chat.tabRail.keyNameRenaming", {
											label: tab.label,
											status,
										})
									: t("chat.tabRail.keyName", {
											label: tab.label,
											status,
										})}
							</span>
						</button>
						{closeShown && (
							<RailCloseButton
								onClose={() => onCloseTab(tab.tabId)}
								onContextMenu={(e) => onKeyContextMenu(e, tab)}
							/>
						)}
						</div>
					);
				})}
			</div>
			<div
				ref={flyoutRef}
				className={`agent-client-tab-rail-flyout${flyoutVisible ? "" : " is-hidden"}`}
				aria-hidden="true"
			>
				{shownTab && (
					<>
						<TabStateIcon state={shownTab.state} decorative />
						<div className="agent-client-tab-rail-flyout-text">
							<div className="agent-client-tab-rail-flyout-name">
								{shownTab.label}
							</div>
							<div className="agent-client-tab-rail-flyout-status">
								{stateLabel(shownTab.state)}
								{aiRenamingTabIds?.has(shownTab.tabId)
									? ` · ${t("chat.tabBar.renamingWithAi")}`
									: ""}
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

/**
 * The hover-only × on a named key (I301). Mouse-only: `aria-hidden`, no name
 * and out of the Tab order, so it doesn't break the tablist's children rule or
 * get Obsidian's aria-label tooltip; keyboard and screen-reader users close
 * with Delete or the context menu. A press never takes focus (the composer
 * keeps it); a middle press also closes, like the key.
 */
function RailCloseButton({
	onClose,
	onContextMenu,
}: {
	onClose: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "x");
	}, []);
	return (
		<button
			ref={ref}
			type="button"
			className="agent-client-tab-rail-close clickable-icon"
			aria-hidden="true"
			tabIndex={-1}
			onMouseDown={(e) => {
				if (e.button === 0 || e.button === 1) e.preventDefault();
				if (e.button === 1) onClose();
			}}
			onClick={onClose}
			onContextMenu={onContextMenu}
		/>
	);
}

/** The AI-rename sparkles in a named key: decorative, no label (no tooltip). */
function RailRenamingIcon() {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "sparkles");
	}, []);
	return (
		<span
			ref={ref}
			className="agent-client-tab-ai-renaming"
			aria-hidden="true"
		/>
	);
}
