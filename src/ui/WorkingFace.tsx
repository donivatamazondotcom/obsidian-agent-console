/**
 * Working face: the Agent Console icon as the "agent is working" indicator.
 *
 * Static markup. Each eye state is its own layer so the CSS can animate it
 * with opacity and transform only (compositor work, no per-frame paint). The
 * working loop and both exits live in styles.css; the phase class on the
 * indicator decides which runs.
 *
 * Spec: [[Agent Console Working Face]] § Design.
 */
import * as React from "react";

import { FACE_GEOMETRY as G } from "./branding";

const STROKE = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: G.stroke,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

function Layer({ name, children }: { name: string; children: React.ReactNode }) {
	return (
		<div className={`agent-client-face-layer agent-client-face-${name}`}>
			<svg viewBox="0 0 100 100">{children}</svg>
		</div>
	);
}

export const WorkingFace = React.memo(function WorkingFace({
	faceRef,
}: {
	faceRef: (el: HTMLElement | null) => void;
}) {
	return (
		<div className="agent-client-working-face" aria-hidden="true" ref={faceRef}>
			<div className="agent-client-face-head">
				<svg viewBox="0 0 100 100">
					<rect
						x={G.head.x}
						y={G.head.y}
						width={G.head.size}
						height={G.head.size}
						rx={G.head.radius}
						ry={G.head.radius}
						fill="none"
						stroke="currentColor"
						strokeWidth={G.head.stroke}
					/>
				</svg>
			</div>
			<Layer name="chev">
				<path d={G.chevron} {...STROKE} />
			</Layer>
			<Layer name="ldash">
				<line x1={G.leftDash.x1} y1={G.leftDash.y} x2={G.leftDash.x2} y2={G.leftDash.y} {...STROKE} />
			</Layer>
			<Layer name="rdash">
				<line x1={G.rightDash.x1} y1={G.rightDash.y} x2={G.rightDash.x2} y2={G.rightDash.y} {...STROKE} />
			</Layer>
			<Layer name="dotl">
				<circle cx={37} cy={50} r={7} fill="currentColor" />
			</Layer>
			<Layer name="dotr">
				<circle cx={67} cy={50} r={7} fill="currentColor" />
			</Layer>
			<Layer name="happy">
				<path d="M 29 55 Q 37 41 45 55" {...STROKE} />
				<path d="M 59 55 Q 67 41 75 55" {...STROKE} />
			</Layer>
		</div>
	);
});
