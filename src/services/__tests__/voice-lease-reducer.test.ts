/**
 * Tests for `voiceLeaseReducer` — each vault's view of who holds the one
 * recording lease, coordinated over a BroadcastChannel.
 *
 * Single-vault scenarios assert the messages and effects. A two-vault
 * simulation wires two reducers together (synchronous delivery, like a
 * BroadcastChannel between vault windows) and checks the cross-vault rules:
 * hand-off, stop-remote, crash recovery, and — as a property — that two
 * vaults never both believe they hold the lease.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	voiceLeaseReducer,
	initialVoiceLease,
	isRemoteHeld,
	isSelfHeld,
	LEASE_TIMEOUT_MS,
	type VoiceLeaseModel,
	type VoiceLeaseEvent,
	type VoiceLeaseEffect,
	type VoiceLeaseMessage,
} from "../voice-lease-reducer";

describe("single vault", () => {
	it("claim takes the lease and announces it", () => {
		const out = voiceLeaseReducer(initialVoiceLease("a"), {
			type: "claim",
			now: 100,
		});
		expect(isSelfHeld(out.state)).toBe(true);
		expect(out.effects).toEqual([
			{ kind: "broadcast", msg: { kind: "claim", from: "a", claimedAt: 100 } },
		]);
	});

	it("release gives it up and announces it", () => {
		const held = voiceLeaseReducer(initialVoiceLease("a"), {
			type: "claim",
			now: 100,
		}).state;
		const out = voiceLeaseReducer(held, { type: "release" });
		expect(out.state.holder).toBeNull();
		expect(out.effects).toEqual([
			{ kind: "broadcast", msg: { kind: "release", from: "a" } },
		]);
	});

	it("release when not holding does nothing", () => {
		const out = voiceLeaseReducer(initialVoiceLease("a"), { type: "release" });
		expect(out.effects).toEqual([]);
	});

	it("the holder sends a heartbeat on each tick", () => {
		const held = voiceLeaseReducer(initialVoiceLease("a"), {
			type: "claim",
			now: 100,
		}).state;
		const out = voiceLeaseReducer(held, { type: "tick", now: 1100 });
		expect(out.effects).toEqual([
			{ kind: "broadcast", msg: { kind: "heartbeat", from: "a", claimedAt: 100 } },
		]);
	});

	it("a vault that hears a heartbeat learns who holds the lease (late joiner)", () => {
		const out = voiceLeaseReducer(initialVoiceLease("b"), {
			type: "message",
			now: 500,
			msg: { kind: "heartbeat", from: "a", claimedAt: 100 },
		});
		expect(isRemoteHeld(out.state)).toBe(true);
	});

	it("its own echoed messages are ignored", () => {
		const start = initialVoiceLease("a");
		const out = voiceLeaseReducer(start, {
			type: "message",
			now: 1,
			msg: { kind: "claim", from: "a", claimedAt: 1 },
		});
		expect(out.state).toEqual(start);
		expect(out.effects).toEqual([]);
	});

	it("stop-remote with no remote holder does nothing", () => {
		const out = voiceLeaseReducer(initialVoiceLease("a"), { type: "stopRemote" });
		expect(out.effects).toEqual([]);
	});
});

// ── Two-vault simulation ─────────────────────────────────────────────────

interface Sim {
	models: Record<string, VoiceLeaseModel>;
	/** Non-broadcast effects each vault received, in order. */
	local: Record<string, VoiceLeaseEffect[]>;
}

const IDS = ["a", "b"] as const;

function newSim(): Sim {
	return {
		models: { a: initialVoiceLease("a"), b: initialVoiceLease("b") },
		local: { a: [], b: [] },
	};
}

/** Apply an event to one vault and deliver broadcasts to the others. */
function send(sim: Sim, id: string, event: VoiceLeaseEvent, now: number): void {
	const queue: { to: string; event: VoiceLeaseEvent }[] = [{ to: id, event }];
	let guard = 0;
	while (queue.length > 0) {
		if (++guard > 50) throw new Error("message storm");
		const { to, event: ev } = queue.shift()!;
		const out = voiceLeaseReducer(sim.models[to], ev);
		sim.models[to] = out.state;
		for (const fx of out.effects) {
			if (fx.kind === "broadcast") {
				for (const other of IDS) {
					if (other !== to) {
						queue.push({
							to: other,
							event: { type: "message", now, msg: fx.msg as VoiceLeaseMessage },
						});
					}
				}
			} else {
				sim.local[to].push(fx);
			}
		}
	}
}

describe("two vaults", () => {
	it("T11: claiming while the other vault holds tells it to yield", () => {
		const sim = newSim();
		send(sim, "a", { type: "claim", now: 100 }, 100);
		send(sim, "b", { type: "claim", now: 200 }, 200);
		expect(isSelfHeld(sim.models.b)).toBe(true);
		expect(isRemoteHeld(sim.models.a)).toBe(true);
		expect(sim.local.a).toEqual([{ kind: "yield" }]);
		expect(sim.local.b).toEqual([]);
	});

	it("both sides agree after a release", () => {
		const sim = newSim();
		send(sim, "a", { type: "claim", now: 100 }, 100);
		send(sim, "a", { type: "release" }, 150);
		expect(sim.models.a.holder).toBeNull();
		expect(sim.models.b.holder).toBeNull();
	});

	it("stop-remote asks the holder to stop its recording", () => {
		const sim = newSim();
		send(sim, "a", { type: "claim", now: 100 }, 100);
		send(sim, "b", { type: "stopRemote" }, 150);
		expect(sim.local.a).toEqual([{ kind: "stopLocal" }]);
		// b does not take the lease by asking a to stop
		expect(isSelfHeld(sim.models.b)).toBe(false);
	});

	it("a stop request meant for another vault is ignored", () => {
		const out = voiceLeaseReducer(
			voiceLeaseReducer(initialVoiceLease("a"), { type: "claim", now: 1 }).state,
			{ type: "message", now: 2, msg: { kind: "stop", from: "b", to: "c" } },
		);
		expect(out.effects).toEqual([]);
	});

	it("a crashed holder's lease expires after the timeout", () => {
		const sim = newSim();
		send(sim, "a", { type: "claim", now: 100 }, 100);
		// a goes silent; b keeps ticking
		send(sim, "b", { type: "tick", now: 100 + LEASE_TIMEOUT_MS }, 100 + LEASE_TIMEOUT_MS);
		expect(isRemoteHeld(sim.models.b)).toBe(true);
		send(
			sim,
			"b",
			{ type: "tick", now: 100 + LEASE_TIMEOUT_MS + 1 },
			100 + LEASE_TIMEOUT_MS + 1,
		);
		expect(sim.models.b.holder).toBeNull();
	});

	it("heartbeats keep a live holder's lease from expiring", () => {
		const sim = newSim();
		send(sim, "a", { type: "claim", now: 0 }, 0);
		for (let t = 1000; t <= 10_000; t += 1000) {
			send(sim, "a", { type: "tick", now: t }, t);
			send(sim, "b", { type: "tick", now: t }, t);
		}
		expect(isRemoteHeld(sim.models.b)).toBe(true);
	});

	it("simultaneous claims resolve to the same single winner on both sides", () => {
		// Both claim at the same instant before hearing each other: deliver a's
		// claim to b and b's claim to a. The tie-break must agree.
		let a = voiceLeaseReducer(initialVoiceLease("a"), { type: "claim", now: 100 });
		let b = voiceLeaseReducer(initialVoiceLease("b"), { type: "claim", now: 100 });
		const aMsg = (a.effects[0] as { msg: VoiceLeaseMessage }).msg;
		const bMsg = (b.effects[0] as { msg: VoiceLeaseMessage }).msg;
		a = voiceLeaseReducer(a.state, { type: "message", now: 101, msg: bMsg });
		b = voiceLeaseReducer(b.state, { type: "message", now: 101, msg: aMsg });
		expect([isSelfHeld(a.state), isSelfHeld(b.state)].filter(Boolean)).toHaveLength(1);
		expect(a.state.holder?.id).toBe(b.state.holder?.id);
	});
});

describe("property: vaults agree once messages settle", () => {
	// Messages are delivered asynchronously and in any order, so two vaults
	// can act before hearing each other — the real BroadcastChannel race.
	// (A synchronous sim can never produce a tie, and missed a removed
	// tie-break.) At every point where nothing is in flight, both vaults must
	// agree on the holder and at most one may believe it holds.
	type Step =
		| { op: "act"; vault: "a" | "b"; type: "claim" | "release" | "tick" | "stopRemote"; dt: number }
		| { op: "deliver"; pick: number };

	const step: fc.Arbitrary<Step> = fc.oneof(
		fc.record({
			op: fc.constant("act" as const),
			vault: fc.constantFrom("a" as const, "b" as const),
			type: fc.constantFrom("claim" as const, "release" as const, "tick" as const, "stopRemote" as const),
			dt: fc.constantFrom(0, 0, 1, 500, LEASE_TIMEOUT_MS + 1),
		}),
		fc.record({ op: fc.constant("deliver" as const), pick: fc.nat() }),
	);

	function settle(
		models: Record<string, VoiceLeaseModel>,
		pending: { to: string; msg: VoiceLeaseMessage }[],
		now: number,
		order: number[],
	): void {
		let i = 0;
		let guard = 0;
		while (pending.length > 0) {
			if (++guard > 200) throw new Error("message storm");
			const k = (order[i++ % Math.max(order.length, 1)] ?? 0) % pending.length;
			const [{ to, msg }] = pending.splice(k, 1);
			const out = voiceLeaseReducer(models[to], { type: "message", now, msg });
			models[to] = out.state;
			for (const fx of out.effects) {
				if (fx.kind === "broadcast") {
					for (const other of IDS) if (other !== to) pending.push({ to: other, msg: fx.msg });
				}
			}
		}
	}

	it("after messages settle, at most one holder and both vaults agree", () => {
		fc.assert(
			fc.property(
				fc.array(step, { minLength: 5, maxLength: 50, size: "max" }),
				fc.array(fc.nat(), { minLength: 1, maxLength: 20 }),
				(steps, order) => {
					const models: Record<string, VoiceLeaseModel> = {
						a: initialVoiceLease("a"),
						b: initialVoiceLease("b"),
					};
					const pending: { to: string; msg: VoiceLeaseMessage }[] = [];
					let now = 0;
					for (const s of steps) {
						if (s.op === "deliver") {
							if (pending.length === 0) continue;
							const [{ to, msg }] = pending.splice(s.pick % pending.length, 1);
							const out = voiceLeaseReducer(models[to], { type: "message", now, msg });
							models[to] = out.state;
							for (const fx of out.effects) {
								if (fx.kind === "broadcast") {
									for (const other of IDS) if (other !== to) pending.push({ to: other, msg: fx.msg });
								}
							}
						} else {
							now += s.dt;
							const event: VoiceLeaseEvent =
								s.type === "claim" || s.type === "tick"
									? { type: s.type, now }
									: { type: s.type };
							const out = voiceLeaseReducer(models[s.vault], event);
							models[s.vault] = out.state;
							for (const fx of out.effects) {
								if (fx.kind === "broadcast") {
									for (const other of IDS) if (other !== s.vault) pending.push({ to: other, msg: fx.msg });
								}
							}
						}
					}
					settle(models, pending, now, order);
					const holders = IDS.filter((id) => isSelfHeld(models[id]));
					expect(holders.length).toBeLessThanOrEqual(1);
					// Agreement: if someone holds, the other vault knows it is them.
					// (A vault may have timed out a silent holder — that is the
					// documented crash-recovery rule, so only self-held is binding.)
					for (const h of holders) {
						for (const id of IDS) {
							if (id !== h && models[id].holder !== null) {
								expect(models[id].holder?.id).toBe(h);
							}
						}
					}
				},
			),
			{ numRuns: 1000 },
		);
	});
});
