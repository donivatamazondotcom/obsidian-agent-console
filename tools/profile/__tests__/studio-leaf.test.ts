/**
 * The seeder writes the restored tabs under the studio's chat leaf id. When
 * the leaf lookup missed (the view type was renamed `agent-console-chat-view`
 * and the lookup only knew `agent-client`), the seeder skipped the tabs
 * without a word and every scenario profiled an empty chat.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { describe, it, expect } from "vitest";
import { findAgentLeafId } from "../studio-leaf";

function workspace(viewType: string) {
	return {
		main: {
			type: "split",
			children: [
				{ id: "md-1", type: "leaf", state: { type: "markdown" } },
				{ id: "chat-1", type: "leaf", state: { type: viewType } },
			],
		},
	};
}

describe("findAgentLeafId", () => {
	it("finds the current chat view type", () => {
		expect(findAgentLeafId(workspace("agent-console-chat-view"))).toBe(
			"chat-1",
		);
	});

	it("finds the legacy chat view type", () => {
		expect(findAgentLeafId(workspace("agent-client-chat-view"))).toBe(
			"chat-1",
		);
	});

	it("returns null when no chat leaf exists", () => {
		expect(findAgentLeafId(workspace("markdown"))).toBeNull();
		expect(findAgentLeafId(null)).toBeNull();
	});
});
