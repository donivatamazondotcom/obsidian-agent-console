// I216: smoke-test-spawn.sh seeds .obsidian/workspace.json with a chat leaf so
// tab state seeded into data.json -> perLeafTabStates restores on first open.
// If the seeded leaf type is not the plugin's registered view type, Obsidian
// drops the leaf at startup and makes a new one with a new id, so the seed
// never restores. These tests run the script's real seeding heredoc against a
// temp studio and check the leaf type it writes against VIEW_TYPE_CHAT.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VIEW_TYPE_CHAT } from "../../../src/ui/chat-view-type";

const REPO = resolve(__dirname, "../../..");
const SCRIPT = join(REPO, "tools/smoke-test/smoke-test-spawn.sh");
const VIEW_TYPE_TS = join(REPO, "src/ui/chat-view-type.ts");
const SEED_MARKER = "# Seed workspace.json";

interface SeedBlock {
	/** The shell line that invokes python3 (env assignments + heredoc start). */
	invocation: string;
	/** The python source between `<<'PY'` and the closing `PY`. */
	python: string;
}

/** Pull the workspace-seed heredoc out of the spawn script. */
function extractSeedBlock(): SeedBlock {
	const lines = readFileSync(SCRIPT, "utf8").split("\n");
	const marker = lines.findIndex((l) => l.includes(SEED_MARKER));
	expect(marker, `marker "${SEED_MARKER}" not found in spawn script`).toBeGreaterThanOrEqual(0);
	const start = lines.findIndex((l, i) => i > marker && l.includes("python3 - <<'PY'"));
	expect(start, "seed heredoc start not found").toBeGreaterThan(marker);
	const end = lines.findIndex((l, i) => i > start && l === "PY");
	expect(end, "seed heredoc end not found").toBeGreaterThan(start);
	return { invocation: lines[start], python: lines.slice(start + 1, end).join("\n") };
}

function runSeed(python: string, env: Record<string, string>) {
	return spawnSync("python3", ["-"], {
		input: python,
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

describe("smoke-test-spawn.sh workspace seed (I216)", () => {
	let studio: string;

	beforeEach(() => {
		studio = mkdtempSync(join(tmpdir(), "i216-studio-"));
		mkdirSync(join(studio, ".obsidian"));
	});
	afterEach(() => {
		rmSync(studio, { recursive: true, force: true });
	});

	it("seeds the active leaf with the plugin's registered view type", () => {
		const { python } = extractSeedBlock();
		const res = runSeed(python, { STUDIO_DIR: studio, CHAT_VIEW_TYPE_TS: VIEW_TYPE_TS });
		expect(res.status, res.stderr).toBe(0);

		const ws = JSON.parse(readFileSync(join(studio, ".obsidian/workspace.json"), "utf8"));
		const leaf = ws.main.children[0].children[0];
		expect(leaf.type).toBe("leaf");
		expect(leaf.state.type).toBe(VIEW_TYPE_CHAT);
		expect(ws.active).toBe(leaf.id);
	});

	it("passes the worktree's chat-view-type.ts to the seed step", () => {
		const { invocation } = extractSeedBlock();
		expect(invocation).toContain("CHAT_VIEW_TYPE_TS=");
	});

	it("fails loudly when the view-type constant can't be read", () => {
		const { python } = extractSeedBlock();
		const bogus = join(studio, "no-constant.ts");
		writeFileSync(bogus, "export const SOMETHING_ELSE = 1;\n");
		const res = runSeed(python, { STUDIO_DIR: studio, CHAT_VIEW_TYPE_TS: bogus });
		expect(res.status).not.toBe(0);
	});
});
