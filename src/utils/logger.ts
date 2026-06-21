export interface LoggerConfig {
	debugMode: boolean;
}

/**
 * Product-name prefix applied to every console message emitted by the plugin,
 * so Agent Console output is recognizable in Obsidian devtools (especially
 * alongside other plugins). Centralized here so call sites do not hardcode
 * their own (internal class-name) prefix. See I90.
 */
const LOG_PREFIX = "[Agent Console]";

let globalLogger: Logger | null = null;

export function initializeLogger(config: LoggerConfig): void {
	if (globalLogger) {
		globalLogger.setDebugMode(config.debugMode);
	} else {
		globalLogger = new Logger(config);
	}
}

export function getLogger(): Logger {
	if (!globalLogger) {
		globalLogger = new Logger({ debugMode: false });
	}
	return globalLogger;
}

export function updateDebugMode(debugMode: boolean): void {
	if (globalLogger) {
		globalLogger.setDebugMode(debugMode);
	}
}

export class Logger {
	private debugMode: boolean;

	constructor(config: LoggerConfig) {
		this.debugMode = config.debugMode;
	}

	setDebugMode(debugMode: boolean): void {
		this.debugMode = debugMode;
	}

	log(...args: unknown[]): void {
		if (this.debugMode) {
			console.debug(LOG_PREFIX, ...args);
		}
	}

	debug(...args: unknown[]): void {
		if (this.debugMode) {
			console.debug(LOG_PREFIX, ...args);
		}
	}

	info(...args: unknown[]): void {
		if (this.debugMode) {
			console.debug(LOG_PREFIX, ...args);
		}
	}

	error(...args: unknown[]): void {
		console.error(LOG_PREFIX, ...args);
	}

	warn(...args: unknown[]): void {
		console.warn(LOG_PREFIX, ...args);
	}
}
