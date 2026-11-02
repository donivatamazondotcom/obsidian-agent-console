/**
 * [[ACP Context Note Hydration]] — hook-seam coverage.
 *
 * H6 / TH10: `hydrated` flips only after a successful send. useAgentMessages
 * calls `onContextDelivered` with the delivered paths on success, and never on
 * a failed send, so the next send re-hydrates.
 * TH05 / H5: `hydrated` survives the session-storage trust boundary.
 * TH06: removing and re-adding a pill yields a fresh, unhydrated entry.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import { useContextNotes } from "../useContextNotes";
import { sanitizeContextNotes, validateContextNotes } from "../../services/context-validator";
import type { PromptContent } from "../../types/chat";

type AMParams = Parameters<typeof useAgentMessages>;

function mount(sendPrompt: (sid: string, c: PromptContent[]) => Promise<void>) {
	const agentClient = { sendPrompt: vi.fn(sendPrompt) } as unknown as AMParams[0];
	const settingsAccess = {
		getSnapshot: () => ({ titleStrategy: "off", windowsWslMode: false }),
	} as unknown as AMParams[1];
	const vaultAccess = {
		getAllFiles: () => [],
		readNote: vi.fn(async () => "pinned body"),
	} as unknown as AMParams[2];
	const session = {
		sessionId: "s1",
		promptCapabilities: { embeddedContext: false },
		authMethods: [],
	} as unknown as AMParams[3];
	return renderHook(() =>
		useAgentMessages(agentClient, settingsAccess, vaultAccess, session, vi.fn()),
	);
}

describe("H6: hydrated flips on send success only", () => {
	it("reports delivered paths after a successful send", async () => {
		const { result } = mount(async () => {});
		const onContextDelivered = vi.fn();
		await act(async () => {
			await result.current.sendMessage("hi", {
				vaultBasePath: "/vault",
				contextNotes: [{ path: "P.md", source: "user", seen: false, hydrated: false }],
				onContextDelivered,
			});
		});
		expect(onContextDelivered).toHaveBeenCalledTimes(1);
		expect(onContextDelivered).toHaveBeenCalledWith(["P.md"]);
	});

	it("TH10: does not report delivery when the send fails", async () => {
		const { result } = mount(async () => {
			throw new Error("agent down");
		});
		const onContextDelivered = vi.fn();
		await act(async () => {
			await result.current.sendMessage("hi", {
				vaultBasePath: "/vault",
				contextNotes: [{ path: "P.md", source: "user", seen: false, hydrated: false }],
				onContextDelivered,
			});
		});
		expect(onContextDelivered).not.toHaveBeenCalled();
	});
});

describe("useContextNotes hydration state", () => {
	it("add() starts unhydrated and markHydrated() flips only the named paths", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => {
			result.current.add("A.md", "user");
			result.current.add("B.md", "mention");
		});
		expect(result.current.notes.map((n) => n.hydrated)).toEqual([false, false]);
		act(() => result.current.markHydrated(["B.md"]));
		expect(result.current.notes.map((n) => [n.path, n.hydrated])).toEqual([
			["A.md", false],
			["B.md", true],
		]);
	});

	it("TH06: remove + re-add yields a fresh unhydrated pill", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => result.current.add("A.md", "user"));
		act(() => result.current.markHydrated(["A.md"]));
		act(() => result.current.remove("A.md"));
		act(() => result.current.add("A.md", "user"));
		expect(result.current.notes[0].hydrated).toBe(false);
	});

	it("markHydrated with no matching change keeps the same array identity", () => {
		const { result } = renderHook(() => useContextNotes());
		act(() => result.current.add("A.md", "user"));
		const before = result.current.notes;
		act(() => result.current.markHydrated(["Nope.md"]));
		expect(result.current.notes).toBe(before);
	});
});

describe("TH05: hydrated across the persistence boundary", () => {
	it("keeps hydrated: true through sanitize", () => {
		const { notes } = sanitizeContextNotes([
			{ path: "A.md", source: "user", seen: false, hydrated: true },
		]);
		expect(notes[0].hydrated).toBe(true);
	});

	it("migrates a pre-hydration entry to hydrated: false", () => {
		const { notes, dropped } = sanitizeContextNotes([
			{ path: "A.md", source: "user", seen: false },
		]);
		expect(notes[0].hydrated).toBe(false);
		expect(dropped).toEqual([]);
	});

	it("validate flags a non-boolean hydrated but accepts an absent one", () => {
		expect(
			validateContextNotes([{ path: "A.md", source: "user", seen: false, hydrated: "yes" }]).map(
				(v) => v.code,
			),
		).toEqual(["bad-hydrated"]);
		expect(validateContextNotes([{ path: "A.md", source: "user", seen: false }])).toEqual([]);
	});
});
