/**
 * Shared plugin stub for tests that render MessageList.
 *
 * MessageList listens on `plugin.app.workspace` for the "Jump to start of
 * latest reply" command, so every suite that renders it needs a workspace
 * with `on` / `offref` / `trigger`. This is a small real event bus rather
 * than no-op stubs, so a test can trigger the command and check that
 * unmount removed the listener. Per-test fields (`mcpAuthManager`,
 * `settingsService`, `settings`, extra `app` members) are merged on top.
 *
 * Production code does not guard on `plugin.app?.` — a real plugin always
 * has an app — so tests use this stub instead of a bare `{}`.
 */
import type AgentClientPlugin from "../plugin";

type Handler = (...args: unknown[]) => void;

export interface TestEventRef {
	name: string;
	callback: Handler;
}

export interface TestWorkspace {
	on(name: string, callback: Handler): TestEventRef;
	offref(ref: TestEventRef): void;
	trigger(name: string, ...args: unknown[]): void;
	/** Number of live listeners for `name` (for unmount assertions). */
	listenerCount(name: string): number;
}

export function makeTestWorkspace(): TestWorkspace {
	const refs: TestEventRef[] = [];
	return {
		on(name, callback) {
			const ref = { name, callback };
			refs.push(ref);
			return ref;
		},
		offref(ref) {
			const i = refs.indexOf(ref);
			if (i >= 0) refs.splice(i, 1);
		},
		trigger(name, ...args) {
			for (const ref of refs.slice()) {
				if (ref.name === name) ref.callback(...args);
			}
		},
		listenerCount(name) {
			return refs.filter((r) => r.name === name).length;
		},
	};
}

/**
 * Build a plugin for MessageList tests. `overrides.app` is merged over the
 * stub app, so a test can add `vault` or a custom `workspace` without
 * losing the other.
 */
export function makeMessageListPlugin(
	overrides: Record<string, unknown> = {},
): AgentClientPlugin {
	const { app: appOverrides, ...rest } = overrides as {
		app?: Record<string, unknown>;
	} & Record<string, unknown>;
	const app = { workspace: makeTestWorkspace(), ...appOverrides };
	return { ...rest, app } as unknown as AgentClientPlugin;
}

/**
 * An MCP auth manager with nothing pending and nothing failed, for tests
 * that render real tool cards (McpAuthBanner) or pass a `viewId`
 * (McpFailureNotice).
 */
export function makeIdleMcpAuthManager(): Record<string, unknown> {
	return {
		getPending: () => [],
		getFailures: () => [],
		onChange: () => () => undefined,
		openSignIn: () => undefined,
		dismissFailures: () => undefined,
	};
}
