// A fresh smoke vault opens on vertical tabs, the layout smoke tests are run
// in. smoke-test-spawn.sh seeds data.json from the fixtures template and drops
// every UI setting so code defaults apply, and the code default for a vault
// that already has data.json is the top bar, so the seed must set tabDisplay
// itself. These tests run the script's real data.json seed heredoc against a
// copy of the real template.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../..");
const SCRIPT = join(REPO, "tools/smoke-test/smoke-test-spawn.sh");
const TEMPLATE = join(
	REPO,
	"tools/screenshots/fixtures/studio/.obsidian/plugins/agent-console/data.template.json",
);

/** Pull the data.json seed heredoc (the SMOKE_DATA_JSON step) out of the script. */
function extractDataSeed(): string {
	const lines = readFileSync(SCRIPT, "utf8").split("\n");
	const start = lines.findIndex(
		(l) => l.includes("SMOKE_DATA_JSON=") && l.includes("python3 - <<'PY'"),
	);
	expect(start, "data.json seed heredoc not found").toBeGreaterThanOrEqual(0);
	const end = lines.findIndex((l, i) => i > start && l === "PY");
	expect(end, "data.json seed heredoc end not found").toBeGreaterThan(start);
	return lines.slice(start + 1, end).join("\n");
}

describe("smoke-test-spawn.sh data.json seed – tab display", () => {
	let dir: string;
	let dataJson: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "smoke-tab-display-"));
		dataJson = join(dir, "data.json");
		copyFileSync(TEMPLATE, dataJson);
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function seed() {
		const res = spawnSync("python3", ["-"], {
			input: extractDataSeed(),
			encoding: "utf8",
			env: { ...process.env, SMOKE_DATA_JSON: dataJson },
		});
		expect(res.status, res.stderr).toBe(0);
		return JSON.parse(readFileSync(dataJson, "utf8")) as Record<string, unknown>;
	}

	it("opens a fresh smoke vault on vertical tabs", () => {
		expect(seed().tabDisplay).toBe("vertical");
	});

	it("still drops other UI settings so code defaults apply", () => {
		const seeded = seed();
		expect(seeded).not.toHaveProperty("restoreTabsOnStartup");
		expect(seeded).not.toHaveProperty("defaultWorkingDirectory");
		expect(seeded).toHaveProperty("claude");
	});
});
