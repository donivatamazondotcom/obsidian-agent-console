/**
 * voice-lease-reducer — one vault's view of who holds the single recording
 * lease shared by every open vault (voice-input feature spec, § Multiple
 * vaults and sessions).
 *
 * Vaults coordinate over a `BroadcastChannel` (verified to reach every vault
 * window, OQ6). Each vault runs this reducer; the adapter posts `broadcast`
 * effects to the channel and feeds received messages back in as `message`
 * events. The reducer never touches the channel or the mic.
 *
 * RULES
 *  - Latest claim wins. That is the hand-off: claiming while another vault
 *    holds tells it to `yield` (its capture reducer finishes the recording
 *    into its own tab). A claim is stamped one past the holder it knows
 *    about, so a deliberate claim always beats the current holder.
 *  - Claims made at the same instant before either vault heard the other
 *    tie-break on vault id. Every claim reaches every vault and each applies
 *    the same rule, so both sides pick the same winner without extra
 *    messages; a vault that opens later learns the holder from heartbeats.
 *  - The holder sends a heartbeat on every tick. Other vaults drop a holder
 *    they haven't heard from for longer than `LEASE_TIMEOUT_MS`, so a crashed
 *    or closed vault can't hold the lease forever.
 *  - `stopRemote` asks the holder to stop; the asker does not take the lease.
 *  - A vault ignores its own echoed messages and stop requests for others.
 *
 * Pure — no React, no Obsidian, no BroadcastChannel.
 */

/** Silence after which a remote holder is treated as gone. */
export const LEASE_TIMEOUT_MS = 5000;

export interface VoiceLeaseHolder {
	id: string;
	claimedAt: number;
	/** Last time this vault heard from the holder (own time for self). */
	lastSeen: number;
}

export interface VoiceLeaseModel {
	/** This vault's id (unique per open vault window). */
	readonly self: string;
	readonly holder: VoiceLeaseHolder | null;
}

export function initialVoiceLease(self: string): VoiceLeaseModel {
	return { self, holder: null };
}

export type VoiceLeaseMessage =
	| { kind: "claim"; from: string; claimedAt: number }
	| { kind: "heartbeat"; from: string; claimedAt: number }
	| { kind: "release"; from: string }
	| { kind: "stop"; from: string; to: string };

export type VoiceLeaseEvent =
	| { type: "claim"; now: number }
	| { type: "release" }
	| { type: "tick"; now: number }
	| { type: "stopRemote" }
	| { type: "message"; now: number; msg: VoiceLeaseMessage };

export type VoiceLeaseEffect =
	| { kind: "broadcast"; msg: VoiceLeaseMessage }
	/** Another vault took the lease — end this vault's recording. */
	| { kind: "yield" }
	/** The holder was asked to stop — stop this vault's recording. */
	| { kind: "stopLocal" };

export interface VoiceLeaseResult {
	state: VoiceLeaseModel;
	effects: VoiceLeaseEffect[];
}

export function isSelfHeld(model: VoiceLeaseModel): boolean {
	return model.holder !== null && model.holder.id === model.self;
}

export function isRemoteHeld(model: VoiceLeaseModel): boolean {
	return model.holder !== null && model.holder.id !== model.self;
}

const unchanged = (state: VoiceLeaseModel): VoiceLeaseResult => ({
	state,
	effects: [],
});

export function voiceLeaseReducer(
	state: VoiceLeaseModel,
	event: VoiceLeaseEvent,
): VoiceLeaseResult {
	const { self, holder } = state;
	switch (event.type) {
		case "claim": {
			const claimedAt =
				holder === null ? event.now : Math.max(event.now, holder.claimedAt + 1);
			return {
				state: { self, holder: { id: self, claimedAt, lastSeen: event.now } },
				effects: [{ kind: "broadcast", msg: { kind: "claim", from: self, claimedAt } }],
			};
		}
		case "release":
			if (!isSelfHeld(state)) return unchanged(state);
			return {
				state: { self, holder: null },
				effects: [{ kind: "broadcast", msg: { kind: "release", from: self } }],
			};
		case "tick":
			if (holder === null) return unchanged(state);
			if (holder.id === self) {
				return {
					state,
					effects: [
						{
							kind: "broadcast",
							msg: { kind: "heartbeat", from: self, claimedAt: holder.claimedAt },
						},
					],
				};
			}
			if (event.now - holder.lastSeen > LEASE_TIMEOUT_MS) {
				return { state: { self, holder: null }, effects: [] };
			}
			return unchanged(state);
		case "stopRemote":
			if (holder === null || holder.id === self) return unchanged(state);
			return {
				state,
				effects: [
					{ kind: "broadcast", msg: { kind: "stop", from: self, to: holder.id } },
				],
			};
		case "message":
			return onMessage(state, event.msg, event.now);
	}
}

function onMessage(
	state: VoiceLeaseModel,
	msg: VoiceLeaseMessage,
	now: number,
): VoiceLeaseResult {
	const { self, holder } = state;
	if (msg.from === self) return unchanged(state);
	switch (msg.kind) {
		case "release":
			if (holder?.id !== msg.from) return unchanged(state);
			return { state: { self, holder: null }, effects: [] };
		case "stop":
			if (msg.to !== self || !isSelfHeld(state)) return unchanged(state);
			return { state, effects: [{ kind: "stopLocal" }] };
		case "claim":
		case "heartbeat": {
			const incoming: VoiceLeaseHolder = {
				id: msg.from,
				claimedAt: msg.claimedAt,
				lastSeen: now,
			};
			// Same holder we already know: refresh.
			if (holder !== null && holder.id === msg.from) {
				return { state: { self, holder: incoming }, effects: [] };
			}
			if (holder === null || beats(incoming, holder)) {
				return {
					state: { self, holder: incoming },
					effects: holder?.id === self ? [{ kind: "yield" }] : [],
				};
			}
			// The incoming claim loses. Nothing to send: the loser also receives
			// our claim (or our next heartbeat) and applies the same tie-break.
			return unchanged(state);
		}
	}
}

/** Latest claim wins; same instant → higher vault id wins. */
function beats(a: VoiceLeaseHolder, b: VoiceLeaseHolder): boolean {
	if (a.claimedAt !== b.claimedAt) return a.claimedAt > b.claimedAt;
	return a.id > b.id;
}
