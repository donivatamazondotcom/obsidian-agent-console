/**
 * A2uiSurfaceHost — mounts one agent-emitted buttons-v0 surface as a sibling
 * of the markdown segments (D11: never inside MarkdownRenderer, which
 * re-renders wholesale per streamed chunk). Stable identity is provided by
 * the caller's key: (sessionId, surfaceId).
 *
 * Trust boundary: the fence body is validated here, once per body change,
 * through the total no-throw validator. Anything invalid — malformed JSON,
 * out-of-profile components, duplicate surfaceIds — renders as the original
 * inert code block plus a muted reason (T06): no partial activation, ever.
 *
 * Keyboard-first: controls are real <button> elements — the platform owns
 * focus, the ring, and Enter/Space activation (repo rule: prefer native
 * button over div[role=button]).
 *
 * Enablement (D7) reads the same pure resolver the dispatch path gates on:
 * idle tab, empty queue slot, unanswered surface. Answered state arrives
 * from the transcript (deriveSurfaceAnswers) via props; local pending state
 * covers the dispatch window and re-enables on failure (T11).
 */
import * as React from "react";
import { useMemo, useState } from "react";
import type AgentClientPlugin from "../plugin";
import { validateA2uiFence } from "../services/a2ui/validator";
import {
	deriveSurfaceActionAffordance,
	type A2uiActionAffordanceReason,
	type A2uiSurfaceStatus,
} from "../services/a2ui/surface-state";
import type { A2uiValidatedSurface } from "../services/a2ui/types";
import type { A2uiButton } from "../services/a2ui/action";
import { MarkdownRenderer } from "./shared/MarkdownRenderer";

export interface A2uiSurfaceHostProps {
	/** Fence body (candidate envelope line). */
	body: string;
	/** Verbatim fence block for the inert fallback rendering. */
	fenceText: string;
	plugin: AgentClientPlugin;
	/** Chosen componentId from the transcript, or null when unanswered. */
	answeredComponentId: string | null;
	/**
	 * Is this fence the FIRST valid definition of the given surfaceId in the
	 * session? Later duplicates render inert (first wins — v1.0 rule). Called
	 * post-validation with the actual surfaceId; default true (no registry).
	 */
	isFirstDefinition?: (surfaceId: string) => boolean;
	/**
	 * Is this surface the LATEST defined in the session? Earlier unanswered
	 * surfaces disable ("superseded") so choices track the conversation
	 * frontier. Default true (single-surface consumers).
	 */
	isLatestDefinition?: (surfaceId: string) => boolean;
	/** A turn is streaming somewhere in this tab. */
	isSending: boolean;
	/** The queue-of-one slot is occupied. */
	isQueued: boolean;
	/** Session history is loading. */
	isRestoringSession: boolean;
	/** The assistant turn containing this surface is still streaming. */
	isStreamingTurn: boolean;
	/**
	 * Dispatch the activation (build envelope + detached send). Resolves true
	 * on success; false re-enables the surface (T11).
	 */
	onActivate: (
		surface: A2uiValidatedSurface,
		button: A2uiButton,
	) => Promise<boolean>;
}

/** Plain-language disabled reasons (user-facing copy rule: no jargon). */
const DISABLED_COPY: Record<
	Exclude<A2uiActionAffordanceReason, "ready">,
	string
> = {
	streaming: "Available when this reply finishes",
	sending: "Wait for the current reply to finish",
	queued: "A message is already waiting to send",
	restoring: "Loading the conversation first",
	pending: "Sending your choice…",
	answered: "Already answered",
	superseded: "Newer choices are below",
};

const INERT_REASON =
	"These buttons couldn't be shown safely, so the content is left as code.";

export function A2uiSurfaceHost(props: A2uiSurfaceHostProps): React.JSX.Element {
	const { body, fenceText, plugin, answeredComponentId } = props;

	const validation = useMemo(() => validateA2uiFence(body), [body]);
	const [pending, setPending] = useState(false);

	const duplicate =
		validation.kind === "valid" &&
		props.isFirstDefinition !== undefined &&
		!props.isFirstDefinition(validation.surface.surfaceId);

	if (validation.kind !== "valid" || duplicate) {
		return (
			<div className="agent-client-a2ui-inert">
				<MarkdownRenderer text={fenceText} plugin={plugin} />
				<div className="agent-client-a2ui-inert-reason">{INERT_REASON}</div>
			</div>
		);
	}
	const surface = validation.surface;

	const status: A2uiSurfaceStatus =
		answeredComponentId !== null
			? "answered"
			: pending
				? "pending"
				: "unanswered";
	const affordance = deriveSurfaceActionAffordance({
		isSending: props.isSending,
		isQueued: props.isQueued,
		isRestoringSession: props.isRestoringSession,
		isStreamingTurn: props.isStreamingTurn,
		surfaceStatus: status,
		isSuperseded:
			props.isLatestDefinition !== undefined &&
			!props.isLatestDefinition(surface.surfaceId),
	});

	const handleActivate = (button: A2uiButton): void => {
		if (!affordance.enabled) return;
		setPending(true);
		void props.onActivate(surface, button).then((sent) => {
			// On success, stay pending — the answered state arrives from the
			// transcript (the sent user message) and supersedes it. On
			// failure, re-enable (T11).
			if (!sent) setPending(false);
		});
	};

	const renderNode = (id: string): React.ReactNode => {
		const component = surface.components.get(id);
		if (component === undefined) return null;
		switch (component.kind) {
			case "text":
				// Plain text by design — never markdown inside controls (D12).
				return (
					<span key={id} className="agent-client-a2ui-text">
						{component.text}
					</span>
				);
			case "divider":
				return <hr key={id} className="agent-client-a2ui-divider" />;
			case "container": {
				const cls =
					component.component === "Card"
						? "agent-client-a2ui-card"
						: component.component === "Row"
							? "agent-client-a2ui-row"
							: "agent-client-a2ui-column";
				return (
					<div key={id} className={cls}>
						{component.children.map(renderNode)}
					</div>
				);
			}
			case "button": {
				const isChosen = answeredComponentId === component.id;
				const disabled = !affordance.enabled;
				const reason =
					affordance.reason === "ready"
						? undefined
						: DISABLED_COPY[affordance.reason];
				const className = [
					"agent-client-a2ui-button",
					isChosen ? "agent-client-a2ui-button-chosen mod-cta" : "",
					status === "answered" && !isChosen
						? "agent-client-a2ui-button-muted"
						: "",
				]
					.filter(Boolean)
					.join(" ");
				return (
					<button
						key={id}
						className={className}
						disabled={disabled}
						aria-label={
							reason !== undefined
								? `${component.label} — ${reason}`
								: undefined
						}
						title={reason}
						onClick={() => handleActivate(component)}
					>
						{component.label}
					</button>
				);
			}
		}
	};

	return (
		<div className="agent-client-a2ui-surface" data-surface-id={surface.surfaceId}>
			{renderNode(surface.rootId)}
		</div>
	);
}
