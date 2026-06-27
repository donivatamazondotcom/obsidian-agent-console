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

export class TAbstractFile {
	path = "";
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "md";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export const setIcon = vi.fn();

export const setTooltip = vi.fn();

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

export class App {}

export class Scope {
	register(
		_modifiers: string[],
		_key: string | null,
		_callback: unknown,
	): unknown {
		return {};
	}
}

export class FuzzySuggestModal<T> {
	app: App;
	scope = new Scope();
	constructor(app: App) {
		this.app = app;
	}
	setPlaceholder(_placeholder: string): void {}
	getItems(): T[] {
		return [];
	}
	getItemText(_item: T): string {
		return "";
	}
	onChooseItem(_item: T, _evt?: MouseEvent | KeyboardEvent): void {}
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
