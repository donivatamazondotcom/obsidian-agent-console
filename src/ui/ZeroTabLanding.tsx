/**
 * ZeroTabLanding — neutral resting screen shown when every tab is closed.
 *
 * Part of "Close Last Tab to Empty State" ([[Agent Console Close Last Tab to
 * Empty State]]). Closing the last tab is now allowed and lands here instead of
 * being blocked. Mirrors a browser's new-tab page: the workspace is never a
 * dead end — you can always start a new chat.
 *
 * Slice 1 (this file) is a MINIMAL placeholder: a short message plus a "New
 * chat" button. Slice 2 swaps the body for the shared reason-tagged empty-state
 * shell (deriveEmptyStateView resolver + relocated Re-detect button); Slice 3
 * adds the live composer and quick prompts; Slice 4 adds "Open session
 * history" at the view level. Keeping this as its own component gives those
 * slices a single, unit-testable swap point.
 */

import * as React from "react";

export interface ZeroTabLandingProps {
	/** Start a new chat with the default agent (mirrors the tab bar's "+"). */
	onNewChat: () => void;
}

export function ZeroTabLanding({ onNewChat }: ZeroTabLandingProps) {
	return (
		<div className="agent-client-zero-tab-landing">
			<div className="agent-client-zero-tab-landing-inner">
				<p className="agent-client-zero-tab-landing-message">
					No chats open. Start a new one to begin.
				</p>
				<button
					type="button"
					className="mod-cta agent-client-zero-tab-landing-new-chat"
					onClick={onNewChat}
				>
					New chat
				</button>
			</div>
		</div>
	);
}
