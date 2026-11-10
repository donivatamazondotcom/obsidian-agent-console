import * as React from "react";

/**
 * The composer rail: a narrow column at the end edge of the text area,
 * directly above Send ([[Agent Console Attachment Button]] § Placement).
 *
 * The rule it sets: the toolbar row holds *settings* (mode, model, config,
 * usage); the composer rail holds *actions you take on the message* (attach,
 * and voice input later). It holds at most two buttons, so it fits beside the
 * text area at its minimum height and stays a short list.
 *
 * Bottom-anchored, so the buttons stay next to Send as the text grows. Renders
 * nothing when it has no buttons, so a surface without them (the zero-tab
 * landing) keeps a full-width text area. Always "composer rail" in names and
 * docs: "rail" alone means the vertical tab rail.
 */
export function ComposerRail({ children }: { children: React.ReactNode }) {
	const items = React.Children.toArray(children).filter(Boolean);
	if (items.length === 0) return null;
	return <div className="agent-client-composer-rail">{items}</div>;
}
