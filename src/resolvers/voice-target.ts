/**
 * `deriveVoiceTarget` — the single pure resolver for where a voice command
 * goes (spec: the voice-input feature spec § Multiple vaults and
 * sessions).
 *
 * RULES
 *  - Starting targets the focused tab (active tab of the focused leaf).
 *  - Only one recording runs at a time across all vaults. Starting somewhere
 *    new while something records hands off: the old recording stops and its
 *    text goes to its own tab, then the new one starts.
 *  - Stopping always ends the current recording, wherever focus is. If this
 *    vault isn't recording but another vault is, stop asks that vault to stop.
 *  - `toggle` (the mic button, "Start/stop voice input") stops when pressed in
 *    the recording tab, and otherwise behaves like `start`. With no focused
 *    tab it behaves like `stop`.
 *  - A tab is identified by leaf + tab id together; the same tab id in another
 *    leaf is a different tab.
 *  - `local` and `remote` both set should not happen (the lease grants one
 *    holder). If it does, this vault's own recording wins, because that is the
 *    one this plugin instance can act on directly.
 *
 * Pure — no React, no Obsidian. Total over the input union.
 */

export interface VoiceTabRef {
	leafId: string;
	tabId: string;
}

export type VoiceCommand = "start" | "stop" | "toggle";

export interface VoiceTargetInput {
	command: VoiceCommand;
	/** Active tab of the focused Agent Console leaf, if any. */
	focused: VoiceTabRef | null;
	/** The tab recording in THIS vault, if any. */
	local: VoiceTabRef | null;
	/** Another vault holds the recording lease. */
	remote: boolean;
}

export type VoiceHandOffSource =
	| { scope: "local"; origin: VoiceTabRef }
	| { scope: "remote" };

export type VoiceTarget =
	| { kind: "start"; target: VoiceTabRef }
	| { kind: "stop"; origin: VoiceTabRef }
	| { kind: "stop-remote" }
	| { kind: "hand-off"; from: VoiceHandOffSource; target: VoiceTabRef }
	| {
			kind: "none";
			reason: "no-focused-tab" | "already-recording" | "not-recording";
	  };

export function deriveVoiceTarget(input: VoiceTargetInput): VoiceTarget {
	switch (input.command) {
		case "stop":
			return stop(input);
		case "start":
			return start(input);
		case "toggle":
			if (input.focused === null) return stopOrNone(input, "no-focused-tab");
			if (input.local !== null && sameTab(input.local, input.focused)) {
				return { kind: "stop", origin: input.local };
			}
			return start(input);
	}
}

function start(input: VoiceTargetInput): VoiceTarget {
	const { focused, local, remote } = input;
	if (focused === null) return { kind: "none", reason: "no-focused-tab" };
	if (local !== null) {
		if (sameTab(local, focused)) {
			return { kind: "none", reason: "already-recording" };
		}
		return {
			kind: "hand-off",
			from: { scope: "local", origin: local },
			target: focused,
		};
	}
	if (remote) {
		return { kind: "hand-off", from: { scope: "remote" }, target: focused };
	}
	return { kind: "start", target: focused };
}

function stop(input: VoiceTargetInput): VoiceTarget {
	return stopOrNone(input, "not-recording");
}

function stopOrNone(
	input: VoiceTargetInput,
	reason: "no-focused-tab" | "not-recording",
): VoiceTarget {
	if (input.local !== null) return { kind: "stop", origin: input.local };
	if (input.remote) return { kind: "stop-remote" };
	return { kind: "none", reason };
}

function sameTab(a: VoiceTabRef, b: VoiceTabRef): boolean {
	return a.leafId === b.leafId && a.tabId === b.tabId;
}
