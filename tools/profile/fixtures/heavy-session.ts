/**
 * Deterministic heavy-session fixture generator for the runtime profiler.
 *
 * Produces a 201-message / 56-code-block session that is byte-for-byte
 * identical across runs (seeded PRNG), matching the plugin's on-disk
 * session schema (`version: 1`). This is the workload the cold-start
 * restore and heavy-transcript-scroll scenarios profile — modelled on the
 * 201-message / 56-code-block session the v1.0.2 restore numbers came from.
 *
 * Pure + deterministic → unit-tested for determinism in
 * `__tests__/heavy-session.test.ts`. Writing it into a studio vault is a
 * separate fs concern handled by `run-profile.ts`.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2 (fixture).
 */

export interface SessionMessageContent {
	type: "text";
	text: string;
}
export interface SessionMessage {
	id: string;
	role: "user" | "assistant";
	content: SessionMessageContent[];
	timestamp: string;
}
export interface SessionFile {
	version: 1;
	sessionId: string;
	agentId: string;
	messages: SessionMessage[];
	contextNotes: unknown[];
	savedAt: string;
}

export interface SavedSessionEntry {
	sessionId: string;
	agentId: string;
	cwd: string;
	title: string;
	createdAt: string;
	updatedAt: string;
}

export interface HeavySessionOptions {
	sessionId?: string;
	agentId?: string;
	cwd?: string;
	title?: string;
	messageCount?: number;
	codeBlockCount?: number;
	seed?: number;
}

const DEFAULTS = {
	sessionId: "profile-heavy-session",
	agentId: "claude-code-acp",
	cwd: "/tmp/notes",
	title: "Runtime profiler heavy session",
	messageCount: 201,
	codeBlockCount: 56,
	seed: 0x5eed,
};

/** mulberry32 — small, fast, fully deterministic PRNG seeded by an int. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = [
	"the",
	"session",
	"restore",
	"layout",
	"render",
	"token",
	"stream",
	"scroll",
	"context",
	"agent",
	"tab",
	"reflow",
	"paint",
	"metric",
	"baseline",
	"heap",
	"style",
	"recalc",
	"profile",
	"transcript",
];

function sentence(rand: () => number, minWords: number, maxWords: number): string {
	const n = minWords + Math.floor(rand() * (maxWords - minWords + 1));
	const parts: string[] = [];
	for (let i = 0; i < n; i++) {
		parts.push(WORDS[Math.floor(rand() * WORDS.length)]);
	}
	const s = parts.join(" ");
	return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function codeBlock(rand: () => number, index: number): string {
	const lines = 3 + Math.floor(rand() * 8);
	const body: string[] = [];
	for (let i = 0; i < lines; i++) {
		body.push(`  const v${i} = ${Math.floor(rand() * 1000)}; // ${sentence(rand, 2, 4)}`);
	}
	return "```ts\n" + `function heavy${index}() {\n` + body.join("\n") + "\n}\n```";
}

/**
 * Generate the deterministic heavy session. Exactly `messageCount`
 * messages (user/assistant alternating, user first) and exactly
 * `codeBlockCount` fenced code blocks, distributed one-per-assistant into
 * the first `codeBlockCount` assistant messages.
 */
export function generateHeavySession(opts: HeavySessionOptions = {}): SessionFile {
	const cfg = { ...DEFAULTS, ...opts };
	const rand = mulberry32(cfg.seed);
	// Fixed epoch base so timestamps are deterministic.
	const base = Date.parse("2026-06-01T00:00:00.000Z");
	const messages: SessionMessage[] = [];
	let codePlaced = 0;

	for (let i = 0; i < cfg.messageCount; i++) {
		const role: "user" | "assistant" = i % 2 === 0 ? "user" : "assistant";
		const paras: string[] = [sentence(rand, 6, 14)];
		if (role === "assistant") {
			// Second prose paragraph for bulk.
			paras.push(sentence(rand, 8, 20));
			if (codePlaced < cfg.codeBlockCount) {
				paras.push(codeBlock(rand, codePlaced));
				codePlaced += 1;
			}
		}
		messages.push({
			id: `m${i + 1}`,
			role,
			content: [{ type: "text", text: paras.join("\n\n") }],
			// 1-minute spacing, deterministic.
			timestamp: new Date(base + i * 60_000).toISOString(),
		});
	}

	return {
		version: 1,
		sessionId: cfg.sessionId,
		agentId: cfg.agentId,
		messages,
		contextNotes: [],
		savedAt: new Date(base + cfg.messageCount * 60_000).toISOString(),
	};
}

/** The `savedSessions` index entry pointing at the generated session. */
export function heavySavedSessionEntry(
	opts: HeavySessionOptions = {},
): SavedSessionEntry {
	const cfg = { ...DEFAULTS, ...opts };
	const base = Date.parse("2026-06-01T00:00:00.000Z");
	return {
		sessionId: cfg.sessionId,
		agentId: cfg.agentId,
		cwd: cfg.cwd,
		title: cfg.title,
		createdAt: new Date(base).toISOString(),
		updatedAt: new Date(base + cfg.messageCount * 60_000).toISOString(),
	};
}

/** Count fenced code blocks in a session (helper for the determinism test). */
export function countCodeBlocks(session: SessionFile): number {
	let fences = 0;
	for (const m of session.messages) {
		for (const c of m.content) {
			const matches = c.text.match(/```/g);
			if (matches) fences += matches.length;
		}
	}
	return fences / 2;
}
