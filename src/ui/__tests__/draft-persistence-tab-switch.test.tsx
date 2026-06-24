/**
 * Ground-truth test for [[ACP Preserve Unsent Draft Text Per Tab]].
 *
 * QUESTION: does switching tabs lose a half-typed draft in a tab's input?
 *
 * The feature spec (2026-06-21) asserts the draft is "lost on tab switch."
 * But ChatView.tsx `ChatComponent` renders EVERY tab's ChatPanel mounted at
 * all times and toggles only `display:none` for inactive tabs — it does NOT
 * conditionally unmount inactive tabs:
 *
 *     {tabs.map((tab) => (
 *       <div key={tab.tabId}
 *            style={{ display: tab.tabId === activeTabId ? "flex" : "none" }}>
 *         ...<ChatPanel viewId={tab.tabId} isActive={...} />...
 *       </div>
 *     ))}
 *
 * Each ChatPanel owns its input via `const [inputValue] = useState("")` and
 * clears it ONLY on send. React preserves a mounted component's state across
 * a `display:none` visibility toggle, so the draft should survive a switch.
 *
 * This test models ChatComponent's render structure faithfully (one child per
 * tab, keyed by tabId, hidden via display:none) to prove the MECHANISM, and
 * contrasts it against the conditional-unmount pattern — what the spec feared,
 * and what the real architecture avoids. Rendering the real ChatComponent here
 * would require mocking plugin/AcpClient/session/vault and would test mounting
 * plumbing rather than draft state, so we model the structure instead (the
 * same approach i70-broadcast-send takes for a structural property).
 */

import { afterEach, describe, expect, it } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import * as React from "react";

// Auto-cleanup is not wired globally in this repo's vitest setup, so renders
// would otherwise accumulate in document.body and make getByTestId ambiguous
// across tests. Unmount each render explicitly.
afterEach(cleanup);

const DRAFT = "half-typed prompt I have not sent yet";

/**
 * Mirrors ChatPanel's input ownership: local useState seeded empty, mutated
 * by the user, cleared only on send (not modelled here — we never "send").
 */
function PanelLike({ tabId }: { tabId: string }) {
	const [value, setValue] = React.useState("");
	return (
		<textarea
			data-testid={`input-${tabId}`}
			value={value}
			onChange={(e) => setValue(e.target.value)}
		/>
	);
}

/**
 * MOUNTED pattern — exactly what ChatView.tsx `ChatComponent` does: all panels
 * mounted, inactive ones hidden via display:none.
 */
function MountedTabs({ tabIds }: { tabIds: string[] }) {
	const [active, setActive] = React.useState(tabIds[0]);
	return (
		<div>
			{tabIds.map((id) => (
				<button
					key={`btn-${id}`}
					data-testid={`switch-${id}`}
					onClick={() => setActive(id)}
				>
					{id}
				</button>
			))}
			{tabIds.map((id) => (
				<div
					key={id}
					style={{ display: id === active ? "block" : "none" }}
				>
					<PanelLike tabId={id} />
				</div>
			))}
		</div>
	);
}

/**
 * CONDITIONAL-UNMOUNT pattern — the anti-pattern the spec feared. Only the
 * active tab's panel is mounted; keyed by `active` so each switch is a true
 * remount (fresh useState). This DOES lose the draft.
 */
function UnmountedTabs({ tabIds }: { tabIds: string[] }) {
	const [active, setActive] = React.useState(tabIds[0]);
	return (
		<div>
			{tabIds.map((id) => (
				<button
					key={`btn-${id}`}
					data-testid={`switch-${id}`}
					onClick={() => setActive(id)}
				>
					{id}
				</button>
			))}
			<PanelLike key={active} tabId={active} />
		</div>
	);
}

describe("Draft text across tab switch (ground truth)", () => {
	it("MOUNTED pattern (ChatView's actual structure): draft SURVIVES a tab switch", () => {
		const { getByTestId } = render(
			<MountedTabs tabIds={["A", "B"]} />,
		);

		// Type a draft in tab A.
		const inputA = getByTestId("input-A") as HTMLTextAreaElement;
		fireEvent.change(inputA, { target: { value: DRAFT } });
		expect(inputA.value).toBe(DRAFT);

		// Switch to tab B — A's panel is hidden, NOT unmounted, so its input
		// node is still in the DOM and retains its value.
		fireEvent.click(getByTestId("switch-B"));
		const inputAStillMounted = getByTestId(
			"input-A",
		) as HTMLTextAreaElement;
		expect(inputAStillMounted.value).toBe(DRAFT);
		// B's own input is independent and empty (no cross-contamination).
		expect((getByTestId("input-B") as HTMLTextAreaElement).value).toBe("");

		// Switch back to A — draft is exactly as left.
		fireEvent.click(getByTestId("switch-A"));
		expect((getByTestId("input-A") as HTMLTextAreaElement).value).toBe(
			DRAFT,
		);
	});

	it("CONDITIONAL-UNMOUNT pattern (anti-pattern): draft is LOST on tab switch", () => {
		const { getByTestId, queryByTestId } = render(
			<UnmountedTabs tabIds={["A", "B"]} />,
		);

		const inputA = getByTestId("input-A") as HTMLTextAreaElement;
		fireEvent.change(inputA, { target: { value: DRAFT } });
		expect(inputA.value).toBe(DRAFT);

		// Switch to B — A's panel unmounts entirely.
		fireEvent.click(getByTestId("switch-B"));
		expect(queryByTestId("input-A")).toBeNull();

		// Switch back to A — fresh mount, draft gone.
		fireEvent.click(getByTestId("switch-A"));
		expect((getByTestId("input-A") as HTMLTextAreaElement).value).toBe("");
	});
});

/**
 * Seeding contract for close/reopen + restart.
 *
 * On reopen/restart, ChatView reads the persisted draft synchronously from
 * the restored leaf state and passes it as `restoredDraft` to a freshly-
 * mounted ChatPanel, which seeds its composer via
 * `useState(restoredDraft ?? "")` and clears it on send. This models that
 * exact contract (a fresh mount with a restoredDraft prop) without the heavy
 * real ChatPanel — the same faithful-harness approach as above.
 */
function SeededPanel({
	restoredDraft,
}: {
	restoredDraft?: string;
}) {
	// Mirrors ChatPanel: const [inputValue, setInputValue] = useState(restoredDraft ?? "")
	const [value, setValue] = React.useState(restoredDraft ?? "");
	return (
		<div>
			<textarea
				data-testid="composer"
				value={value}
				onChange={(e) => setValue(e.target.value)}
			/>
			{/* Mirrors send: clears the composer (draft is only "in flight"). */}
			<button data-testid="send" onClick={() => setValue("")}>
				send
			</button>
		</div>
	);
}

describe("Draft seeding on reopen/restart (ChatPanel contract)", () => {
	it("seeds the composer from a restored draft (reopen/restart restores it)", () => {
		const { getByTestId } = render(
			<SeededPanel restoredDraft={DRAFT} />,
		);
		expect((getByTestId("composer") as HTMLTextAreaElement).value).toBe(
			DRAFT,
		);
	});

	it("composer is empty when there is no restored draft", () => {
		const { getByTestId } = render(<SeededPanel />);
		expect((getByTestId("composer") as HTMLTextAreaElement).value).toBe("");
	});

	it("after send clears the draft, a fresh mount (reopen) shows an empty composer", () => {
		// First mount: user typed + sent → composer cleared → persisted draft
		// would be "" (getDraft returns "").
		const first = render(<SeededPanel restoredDraft={DRAFT} />);
		fireEvent.click(first.getByTestId("send"));
		expect(
			(first.getByTestId("composer") as HTMLTextAreaElement).value,
		).toBe("");
		cleanup();

		// Reopen with the now-empty persisted draft → empty composer, no stale
		// text resurrected.
		const second = render(<SeededPanel restoredDraft="" />);
		expect(
			(second.getByTestId("composer") as HTMLTextAreaElement).value,
		).toBe("");
	});

	it("a later restoredDraft prop change does NOT clobber live typing (initializer runs once)", () => {
		const { getByTestId, rerender } = render(
			<SeededPanel restoredDraft="" />,
		);
		// User starts typing into a fresh tab.
		fireEvent.change(getByTestId("composer"), {
			target: { value: "user is typing now" },
		});
		// A late async restore tries to push a different draft via props.
		rerender(<SeededPanel restoredDraft="late async draft" />);
		// Live typing wins — useState initializer only runs at mount.
		expect((getByTestId("composer") as HTMLTextAreaElement).value).toBe(
			"user is typing now",
		);
	});
});
