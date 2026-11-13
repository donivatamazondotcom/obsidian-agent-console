/**
 * The "Hand off to a fresh chat" recipe, run for real: the Python command
 * from docs/usage/quick-prompts.md is filled in the way a user and an agent
 * fill it, run under bash (and zsh where installed), and the link it builds
 * is parsed by the plugin's own parser.
 *
 * Spec: [[Agent Console Fresh-Session Handoff]] T07 (strict encoding round
 * trip, link in a markdown reply) and T17 (vault name with an apostrophe).
 * Running the real script, not a TypeScript copy of its encoding, keeps the
 * test honest (R5) and fails if the docs and the plugin drift apart.
 *
 * Red-first: written before the docs recipe and the `crc` rules existed.
 * Related: [[I342 A link that arrives before the chat view is ready opens
 * nothing silently]] is covered in quick-prompts-uri-fire.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseQuickPromptUri } from "../utils/quick-prompt-uri";
import { crc32Hex } from "../utils/crc32";
import { extractLinks } from "../utils/link-extract";
import { buildQuickPrompt, planUriFire } from "../services/quick-prompts-logic";

const DOCS = join(__dirname, "../../docs/usage/quick-prompts.md");
const SUFFIX = "Zq7Xw2Lp";

/** The recipe's command: from `python3 -c '` to the closing delimiter. */
function readRecipe(): string {
	const md = readFileSync(DOCS, "utf8");
	const re = /\n(python3 -c '\n[\s\S]*?\nHANDOFF_<8 random letters and digits>)\n/g;
	const found = [...md.matchAll(re)].map((m) => m[1]);
	if (found.length !== 1) {
		throw new Error(
			`expected one recipe in docs/usage/quick-prompts.md, found ${found.length}`,
		);
	}
	return found[0];
}

/**
 * The docs' Continue handoff note, built the way the plugin builds a prompt
 * note. The block's frontmatter is plain `key: value` lines, so a tiny
 * parser stands in for Obsidian's YAML (booleans as booleans).
 */
function readContinuePrompt() {
	const md = readFileSync(DOCS, "utf8");
	// The note's name comes from the docs' own setup step, so a rename there
	// changes the id this test checks.
	const name = md.match(/make a prompt note named \*\*([^*]+)\*\*/)?.[1];
	if (!name) throw new Error("Continue handoff note name not found in the docs");
	const m = md.match(/```text\n---\n((?:[^\n]*\n)*?)---\n([\s\S]*?\{\{selection\}\})\n```/);
	if (!m) throw new Error("Continue handoff block not found in docs/usage/quick-prompts.md");
	const frontmatter: Record<string, unknown> = {};
	for (const line of m[1].split("\n").filter(Boolean)) {
		// Plain top-level `key: value` only; anything else fails loud.
		const kv = /^([a-z][a-z ]*[a-z]): (\S.*)$/.exec(line);
		if (!kv) throw new Error(`unexpected frontmatter line: ${JSON.stringify(line)}`);
		const [, key, value] = kv;
		if (key in frontmatter) throw new Error(`duplicate frontmatter key: ${key}`);
		frontmatter[key] = value === "true" ? true : value === "false" ? false : value;
	}
	return buildQuickPrompt({
		path: `Quick Prompts/${name}.md`,
		basename: name,
		frontmatter,
		body: m[2],
	});
}

/** Fill the recipe the way the docs tell the user and the agent to. */
function fill(
	recipe: string,
	o: { vault: string; handoff: string; link: boolean; dropEndLine?: boolean },
): string {
	let s = recipe
		.split("<vault>")
		.join(o.vault)
		.split("<8 random letters and digits>")
		.join(SUFFIX)
		.split("<the prompt>")
		.join(o.handoff);
	if (o.dropEndLine) s = s.split("\nHANDOFF-COMPLETE\n").join("\n");
	if (o.link) s = s.split(`' <<'HANDOFF_${SUFFIX}'`).join(`' --link <<'HANDOFF_${SUFFIX}'`);
	return s;
}

/** Split a link the way Obsidian does: each part percent-decoded. */
function linkParams(link: string): Record<string, string> {
	const query = link.slice(link.indexOf("?") + 1);
	const params: Record<string, string> = {};
	for (const part of query.split("&")) {
		const eq = part.indexOf("=");
		const key = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
		params[key] = eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1));
	}
	return params;
}

const SHELLS = ["bash", ...(existsSync("/bin/zsh") ? ["/bin/zsh"] : [])];

describe.skipIf(process.platform === "win32")("handoff recipe (T07, T17)", () => {
	let dir: string;
	let bin: string;
	let handoff: string;
	let markers: string[];

	beforeAll(() => {
		const py = spawnSync("python3", ["--version"], { encoding: "utf8" });
		if (py.status !== 0) {
			throw new Error("python3 is required for the handoff recipe test");
		}
		dir = mkdtempSync(join(tmpdir(), "handoff-recipe-"));
		bin = join(dir, "bin");
		spawnSync("mkdir", [bin]);
		// A stand-in `open` that records the link instead of opening it.
		const open = join(bin, "open");
		writeFileSync(open, `#!/bin/sh\nprintf '%s' "$1" > "${dir}/opened"\n`);
		chmodSync(open, 0o755);
		markers = ["a", "b", "c", "d"].map((m) => join(dir, `ran-${m}`));
		// Each marker line creates a file only if the shell runs it.
		handoff = [
			"# Resume the work",
			"",
			"Goal: ship A&B with 100% care + a (small) fix! *now* 'quoted' ~tilde #42.",
			`Run \`touch ${markers[0]}\` and $(touch ${markers[1]}) only if told.`,
			'An odd quote: "one',
			"```sh",
			`touch ${markers[2]}`,
			"```",
			`touch ${markers[3]}`,
			"Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}, keycap 1\uFE0F\u20E3 and \u{1F642}",
			"Sample link: obsidian://agent-console?vault=x&prompt=y&mode=plan",
			"Unbalanced ) paren",
		].join("\n");
	});

	afterAll(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	/** Run with no startup files, so a developer's shell config can't interfere. */
	const run = (shell: string, script: string) => {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			PATH: `${bin}:${process.env.PATH ?? ""}`,
			LC_ALL: "C",
		};
		delete env.BASH_ENV;
		delete env.ENV;
		const args = shell.endsWith("zsh")
			? ["-f", "-c", script]
			: ["--norc", "--noprofile", "-c", script];
		return spawnSync(shell, args, { encoding: "utf8", env });
	};

	for (const shell of SHELLS) {
		it(`${shell}: --link prints a link the plugin parses back to the exact text`, () => {
			rmSync(join(dir, "opened"), { force: true });
			const r = run(
				shell,
				fill(readRecipe(), { vault: "Sam\\x27s Vault", handoff, link: true }),
			);
			expect(r.stderr).toBe("");
			expect(r.status).toBe(0);
			for (const m of markers) expect(existsSync(m)).toBe(false);
			expect(existsSync(join(dir, "opened"))).toBe(false);

			const link = r.stdout.trim();
			expect(link.startsWith(
				"obsidian://agent-console?vault=Sam%27s%20Vault&prompt=continue-handoff&crc=",
			)).toBe(true);
			expect(link).not.toMatch(/[()]/);

			const params = linkParams(link);
			expect(params.vault).toBe("Sam's Vault");
			expect(params.crc).toBe(crc32Hex(handoff));
			expect(
				parseQuickPromptUri(params, [{ id: "continue-handoff" }], { strictKeys: true }),
			).toEqual({
				kind: "ok",
				prompt: { id: "continue-handoff" },
				context: { selection: handoff },
			});
		});

		it(`${shell}: without --link it opens the same link and prints "sent"`, () => {
			rmSync(join(dir, "opened"), { force: true });
			const r = run(
				shell,
				fill(readRecipe(), { vault: "Sam\\x27s Vault", handoff, link: false }),
			);
			expect(r.status).toBe(0);
			expect(r.stdout.trim()).toBe("sent");
			const opened = readFileSync(join(dir, "opened"), "utf8");
			expect(linkParams(opened).selection).toBe(handoff);
			for (const m of markers) expect(existsSync(m)).toBe(false);
		});

		it(`${shell}: a handoff without its end line opens nothing`, () => {
			const r = run(
				shell,
				fill(readRecipe(), {
					vault: "Sam\\x27s Vault",
					handoff,
					link: true,
					dropEndLine: true,
				}),
			);
			expect(r.status).not.toBe(0);
			expect(r.stdout).toBe("");
			expect(r.stderr).toContain("did not end with HANDOFF-COMPLETE");
			for (const m of markers) expect(existsSync(m)).toBe(false);
		});
	}

	it("stages the handoff under the docs' Continue handoff prompt, ignoring a link's agent and mode", () => {
		const prompt = readContinuePrompt();
		expect(prompt.id).toBe("continue-handoff");
		expect(prompt.uriOverride).toBe(false);

		const r = run(
			"bash",
			fill(readRecipe(), { vault: "Sam\\x27s Vault", handoff, link: true }),
		);
		expect(r.status).toBe(0);
		// Someone appends agent and mode; the crc covers only the selection.
		const params = linkParams(`${r.stdout.trim()}&agent=test-other&mode=plan`);
		const parsed = parseQuickPromptUri(params, [prompt], { strictKeys: true });
		if (parsed.kind !== "ok") throw new Error(`expected ok, got ${parsed.kind}`);
		const plan = planUriFire(prompt, parsed.context, {
			agents: [
				{ id: "test-claude", name: "Test Claude" },
				{ id: "test-other", name: "Test Other" },
			],
			defaultAgentId: "test-claude",
		});
		if (plan.kind !== "new-tab") throw new Error("expected new-tab");
		expect(plan).toMatchObject({ send: false, agentId: "test-claude", linkOrigin: false });
		expect(plan.modeId).toBeUndefined();

		const lines = plan.text.split("\n");
		const heading = lines.findIndex((l) => l.startsWith("External text · "));
		expect(lines.slice(0, heading).join("\n")).toBe(
			"Continue the work in the handoff below, written at the end of an earlier chat. Start by reading the notes and files it points to.\n",
		);
		const quoted = lines.slice(heading + 1);
		expect(quoted).toEqual(handoff.split("\n").map((l) => (l === "" ? ">" : `> ${l}`)));
		expect(quoted[quoted.length - 1]).not.toBe(">");
	});

	it("a reply's markdown link keeps the whole target (T07)", () => {
		const r = run(
			"bash",
			fill(readRecipe(), { vault: "Sam\\x27s Vault", handoff, link: true }),
		);
		const link = r.stdout.trim();
		const links = extractLinks([
			{
				id: "m1",
				role: "assistant",
				content: [{ type: "text", text: `[Continue in a new chat](${link})` }],
				timestamp: new Date(),
			},
		]);
		expect(links).toHaveLength(1);
		expect(links[0].target).toBe(link);
	});
});
