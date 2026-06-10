/**
 * Minimal `obsidian` module stub for unit tests.
 *
 * The real `obsidian` package on npm is types-only (`"main": ""`); the
 * runtime is provided by Obsidian itself. Tests that import from
 * `obsidian` get this stub via the alias in `vitest.config.ts`.
 *
 * Add new exports here as new test files require them. Each export should
 * be the smallest viable stub — just enough for the source file under test
 * to instantiate / render without throwing.
 *
 * Tests that exercise specific Obsidian API surfaces should `vi.mock("obsidian", ...)`
 * within the test file to override these defaults with assertions.
 */

import { vi } from "vitest";

export const setIcon = vi.fn();

export const MarkdownRenderer = {
	render: vi.fn(),
	renderMarkdown: vi.fn(),
};

export class Component {
	load() {}
	unload() {}
	registerEvent() {}
	registerDomEvent() {}
	addChild() {}
	removeChild() {}
}

export class Modal {
	open() {}
	close() {}
}

export class Notice {
	constructor(_message: string) {}
}

export const Platform = {
	isMobile: false,
	isDesktop: true,
};

export class FileSystemAdapter {
	getBasePath() {
		return "";
	}
}
