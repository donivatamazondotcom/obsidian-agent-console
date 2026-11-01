/**
 * I209 — `ready → released → connecting` (spec § 2, § 6 test 2).
 *
 * Every state × RELEASE, and `released` × every action. RELEASE is the
 * reducer's first gated action: only `ready` may release. A released tab
 * leaves only by START_CONNECT (keystroke / send) or RESET (new chat / agent
 * switch); busy, permission and connect results are rejected.
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	useTabSessionState,
	type TabSessionState,
	type TabSessionStateApi,
} from "../useTabSessionState";

function machine(initialState: TabSessionState) {
	return renderHook(() => useTabSessionState({ initialState }));
}

describe("I209 RELEASE from every state", () => {
	const expected: Array<[TabSessionState, TabSessionState]> = [
		["ready", "released"],
		["idle", "idle"],
		["connecting", "connecting"],
		["busy", "busy"],
		["permission", "permission"],
		["error", "error"],
		["released", "released"],
	];
	it.each(expected)("%s --RELEASE--> %s", (from, to) => {
		const { result } = machine(from);
		act(() => result.current.release());
		expect(result.current.state).toBe(to);
	});
});

describe("I209 every action from released", () => {
	const expected: Array<[keyof TabSessionStateApi, TabSessionState]> = [
		["startConnect", "connecting"],
		["reset", "idle"],
		["connectSucceeded", "released"],
		["connectFailed", "released"],
		["startBusy", "released"],
		["endBusy", "released"],
		["requestPermission", "released"],
		["resolvePermission", "released"],
		["release", "released"],
	];
	it.each(expected)("released --%s--> %s", (method, to) => {
		const { result } = machine("released");
		act(() => {
			(result.current[method] as () => void)();
		});
		expect(result.current.state).toBe(to);
	});

	it("reconnect completes: released → connecting → ready", () => {
		const { result } = machine("released");
		act(() => result.current.startConnect());
		act(() => result.current.connectSucceeded());
		expect(result.current.state).toBe("ready");
	});
});
