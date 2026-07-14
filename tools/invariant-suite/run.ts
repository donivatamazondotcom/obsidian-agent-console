/**
 * In-Obsidian invariant suite runner.
 *
 * Usage:
 *   npx tsx tools/invariant-suite/run.ts --vault ST-<worktree>
 *   npx tsx tools/invariant-suite/run.ts --vault studio --only INV-2,INV-4
 *
 * Probes a RUNNING Obsidian instance over the obsidian CLI's CDP surface
 * (same substrate as tools/screenshots). Asserts standing invariants that
 * jsdom unit tests cannot reach: real workspace focus, keymap scope stack,
 * persisted plugin data on disk.
 *
 * SAFETY: some probes mutate disposable UI state (e.g. INV-1 opens a new
 * chat tab). The runner therefore refuses to target anything but a smoke
 * vault (studio / ST-*) unless --allow-vault is passed explicitly. Never
 * point it at a working vault — see the agent-console skill rules.
 *
 * Exit code: 0 when no invariant fails (todo/skip do not fail the run),
 * 1 on any failure, 2 on harness-level errors.
 *
 * Spec: vault note "Verification Overhaul" (Pillar 3).
 */
import { Cdp } from "../screenshots/lib/cdp";
import {
	ensureChatViewOpen,
	invariants,
	type InvariantResult,
} from "./lib/invariants";

export interface CliArgs {
	vault: string | null;
	only: string[] | null;
	allowVault: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = { vault: null, only: null, allowVault: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--vault") args.vault = argv[++i] ?? null;
		else if (a === "--only")
			args.only = (argv[++i] ??"").split(",").map((s) => s.trim()).filter(Boolean);
		else if (a === "--allow-vault") args.allowVault = true;
	}
	return args;
}

/**
 * Only disposable smoke vaults are allowed by default. INV-1 creates a
 * tab; a working vault holds live agent sessions we must never disturb.
 */
export function isAllowedVault(vault: string | null, allowOverride: boolean): boolean {
	if (allowOverride) return vault !== null;
	if (!vault) return false;
	return vault === "studio" || vault.startsWith("ST-");
}

export function formatReport(results: InvariantResult[]): string {
	const icon: Record<string, string> = {
		pass: "✓",
		fail: "✗",
		skip: "•",
		todo: "…",
	};
	const lines = results.map(
		(r) =>
			`  ${icon[r.status]} ${r.id} ${r.status.toUpperCase().padEnd(4)} ${r.name} — ${r.detail} [guards: ${r.guards}]`,
	);
	const fails = results.filter((r) => r.status === "fail").length;
	const passes = results.filter((r) => r.status === "pass").length;
	const todos = results.filter((r) => r.status === "todo").length;
	const skips = results.filter((r) => r.status === "skip").length;
	lines.push("");
	lines.push(
		`  ${passes} pass, ${fails} fail, ${skips} skip, ${todos} todo (of ${results.length})`,
	);
	return lines.join("\n");
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.vault) {
		console.error(
			"Usage: npx tsx tools/invariant-suite/run.ts --vault <studio|ST-name> [--only INV-1,INV-2] [--allow-vault]",
		);
		return 2;
	}
	if (!isAllowedVault(args.vault, args.allowVault)) {
		console.error(
			`Refusing to run against vault "${args.vault}" — invariant probes mutate disposable UI state and must only target smoke vaults (studio / ST-*). Pass --allow-vault to override if you are certain.`,
		);
		return 2;
	}

	const cdp = new Cdp({ vault: args.vault });

	// Preflight: the target vault must be open and be the vault we think it is.
	let name: string;
	try {
		name = await cdp.evaluate<string>("window.app.vault.getName()");
	} catch (err) {
		console.error(
			`Cannot reach vault "${args.vault}" over CDP — is it open in Obsidian? (${err instanceof Error ? err.message : String(err)})`,
		);
		return 2;
	}
	if (name !== args.vault) {
		console.error(
			`Vault mismatch: asked for "${args.vault}" but CDP resolved "${name}". Aborting — the vault= scope did not land.`,
		);
		return 2;
	}

	await ensureChatViewOpen(cdp);

	const selected = args.only
		? invariants.filter((inv) => args.only?.includes(inv.id))
		: invariants;
	if (selected.length === 0) {
		console.error(`--only matched no invariants (have: ${invariants.map((i) => i.id).join(", ")})`);
		return 2;
	}

	const results: InvariantResult[] = [];
	for (const inv of selected) {
		try {
			const { status, detail } = await inv.run(cdp);
			results.push({ id: inv.id, name: inv.name, guards: inv.guards, status, detail });
		} catch (err) {
			results.push({
				id: inv.id,
				name: inv.name,
				guards: inv.guards,
				status: "fail",
				detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	console.log(`\nInvariant suite — vault "${args.vault}"\n`);
	console.log(formatReport(results));
	console.log("");
	return results.some((r) => r.status === "fail") ? 1 : 0;
}

// Only execute when run directly (not when imported by tests).
if (process.argv[1] && /run\.(ts|js)$/.test(process.argv[1])) {
	main().then(
		(code) => process.exit(code),
		(err) => {
			console.error(err);
			process.exit(2);
		},
	);
}
