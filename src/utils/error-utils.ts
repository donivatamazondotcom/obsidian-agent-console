/**
 * ACP Error Utilities
 *
 * Utilities for handling ACP protocol errors and converting them
 * to user-friendly ErrorInfo for UI display.
 *
 * These functions extract error information from ACP JSON-RPC errors
 * and provide appropriate titles and suggestions based on error codes.
 */

import { Platform } from "obsidian";
import { AcpErrorCode, type AcpError, type ErrorInfo } from "../types/errors";
import { t } from "../i18n";

// ============================================================================
// Error Extraction Functions
// ============================================================================

/**
 * Extract error code from unknown error object.
 */
export function extractErrorCode(error: unknown): number | undefined {
	if (error && typeof error === "object" && "code" in error) {
		const code = error.code;
		if (typeof code === "number") return code;
	}
	return undefined;
}

/**
 * Extract error message from ACP error object.
 * Checks both `message` field and `data.details` for compatibility.
 */
export function extractErrorMessage(error: unknown): string {
	if (!error || typeof error !== "object") {
		return t("chat.acpErrors.unexpected");
	}

	// Check data.details first (some agents use this format)
	if ("data" in error) {
		const data = error.data;
		if (data && typeof data === "object" && "details" in data) {
			const details = data.details;
			if (typeof details === "string") return details;
		}
	}

	// Then check message
	if ("message" in error) {
		const msg = error.message;
		if (typeof msg === "string") return msg;
	}

	return t("chat.acpErrors.unexpected");
}

/**
 * Extract error data from ACP error object.
 */
export function extractErrorData(error: unknown): unknown {
	if (error && typeof error === "object" && "data" in error) {
		return error.data;
	}
	return undefined;
}

// ============================================================================
// Error Classification Functions
// ============================================================================

/**
 * I317: a service error the agent already wrote for the user, sent on -32000.
 *
 * Kiro CLI V3 sends every user-facing service failure (throttling, usage
 * limits, network faults) as JSON-RPC -32000 with the display message and the
 * error class in `data.errorType`. -32000 is also ACP's "auth required" code,
 * so the code alone can't tell them apart. A generic auth request carries no
 * `data.errorType`; Kiro's own sign-in errors (SignInRequiredError,
 * ModelRegistryUnauthenticatedError, token and credential errors) do, and
 * they stay auth errors.
 */
export function isAgentServiceError(data: unknown): boolean {
	return (
		!!data &&
		typeof data === "object" &&
		"errorType" in data &&
		typeof data.errorType === "string" &&
		!AUTH_ERROR_TYPE.test(data.errorType)
	);
}

/**
 * Error classes that mean "sign in again" (Kiro CLI V3 names, 3.1.2).
 * Deliberately absent, because signing in again won't help:
 * AccessDeniedError (signed in but not allowed) and
 * ProxyAuthenticationRequiredError (HTTP 407; the proxy needs credentials).
 * Keep the pattern to these names: a bare "Authentication" or "Token" would
 * also match those and TokenEstimationError.
 */
const AUTH_ERROR_TYPE =
	/SignIn|Unauthenticated|AuthRefreshFailed|Token(Expired|Invalid)|CredentialAbsent/;

/** I317: the service error is a throttle ("busy, try again"). */
export function isThrottleError(data: unknown): boolean {
	if (!data || typeof data !== "object") return false;
	if ("retryErrorType" in data && data.retryErrorType === "THROTTLING") {
		return true;
	}
	return (
		"errorType" in data &&
		typeof data.errorType === "string" &&
		/ThrottleError$/.test(data.errorType)
	);
}

/** I317: -32000 means "authenticate" only when it isn't a service error. */
export function isAuthRequiredError(error: unknown): boolean {
	return (
		extractErrorCode(error) === AcpErrorCode.AUTHENTICATION_REQUIRED &&
		!isAgentServiceError(extractErrorData(error))
	);
}

/**
 * Get user-friendly title for ACP error code.
 */
export function getErrorTitle(
	code: number | undefined,
	data?: unknown,
): string {
	if (isThrottleError(data)) return t("chat.acpErrors.titleBusy");
	if (
		code === AcpErrorCode.AUTHENTICATION_REQUIRED &&
		isAgentServiceError(data)
	) {
		return t("chat.acpErrors.titleAgent");
	}
	switch (code) {
		case AcpErrorCode.PARSE_ERROR:
			return t("chat.acpErrors.titleProtocol");
		case AcpErrorCode.INVALID_REQUEST:
			return t("chat.acpErrors.titleInvalidRequest");
		case AcpErrorCode.METHOD_NOT_FOUND:
			return t("chat.acpErrors.titleMethodNotSupported");
		case AcpErrorCode.INVALID_PARAMS:
			return t("chat.acpErrors.titleInvalidParams");
		case AcpErrorCode.INTERNAL_ERROR:
			return t("chat.acpErrors.titleInternal");
		case AcpErrorCode.AUTHENTICATION_REQUIRED:
			return t("chat.acpErrors.titleAuthRequired");
		case AcpErrorCode.RESOURCE_NOT_FOUND:
			return t("chat.acpErrors.titleResourceNotFound");
		default:
			return t("chat.acpErrors.titleAgent");
	}
}

/**
 * Get suggestion for ACP error code.
 * Uses error message content to provide more specific suggestions.
 */
export function getErrorSuggestion(
	code: number | undefined,
	message: string,
	data?: unknown,
): string {
	if (isThrottleError(data)) return t("chat.acpErrors.suggestBusy");
	if (
		code === AcpErrorCode.AUTHENTICATION_REQUIRED &&
		isAgentServiceError(data)
	) {
		return t("chat.acpErrors.suggestTryAgainRestart");
	}
	// Check for context exhaustion in message (Internal Error)
	if (code === AcpErrorCode.INTERNAL_ERROR) {
		const lowerMsg = message.toLowerCase();
		if (
			lowerMsg.includes("context") ||
			lowerMsg.includes("token") ||
			lowerMsg.includes("max_tokens") ||
			lowerMsg.includes("too long")
		) {
			return t("chat.acpErrors.suggestTooLong");
		}
		if (lowerMsg.includes("overloaded") || lowerMsg.includes("capacity")) {
			return t("chat.acpErrors.suggestBusy");
		}
	}

	switch (code) {
		case AcpErrorCode.PARSE_ERROR:
		case AcpErrorCode.INVALID_REQUEST:
		case AcpErrorCode.METHOD_NOT_FOUND:
			return t("chat.acpErrors.suggestRestart");
		case AcpErrorCode.INVALID_PARAMS:
			return t("chat.acpErrors.suggestCheckConfig");
		case AcpErrorCode.INTERNAL_ERROR:
			return t("chat.acpErrors.suggestTryAgainRestart");
		case AcpErrorCode.AUTHENTICATION_REQUIRED:
			return t("chat.acpErrors.suggestCheckAuth");
		case AcpErrorCode.RESOURCE_NOT_FOUND:
			return t("chat.acpErrors.suggestCheckResource");
		default:
			return t("chat.acpErrors.suggestTryAgainRestart");
	}
}

// ============================================================================
// Error Conversion Functions
// ============================================================================

/**
 * Convert unknown error to AcpError.
 * The error's message field is used directly for user display.
 */
export function toAcpError(
	error: unknown,
	sessionId?: string | null,
): AcpError {
	const code = extractErrorCode(error) ?? -1;
	const message = extractErrorMessage(error);
	const data = extractErrorData(error);

	return {
		code,
		message, // Agent's message is used directly
		data,
		sessionId,
		originalError: error,
		title: getErrorTitle(code, data),
		suggestion: getErrorSuggestion(code, message, data),
	};
}

/**
 * Convert AcpError to ErrorInfo for UI display.
 */
export function toErrorInfo(acpError: AcpError): ErrorInfo {
	return {
		title: acpError.title,
		message: acpError.message,
		suggestion: acpError.suggestion,
	};
}

// ============================================================================
// Error Check Functions
// ============================================================================

/**
 * Check if error is the "empty response text" error that should be ignored.
 */
export function isEmptyResponseError(error: unknown): boolean {
	const code = extractErrorCode(error);
	if (code !== AcpErrorCode.INTERNAL_ERROR) {
		return false;
	}

	const message = extractErrorMessage(error);
	return message.includes("empty response text");
}

/**
 * Extract a user-friendly error hint from stderr output.
 * Detects common failure patterns like missing API keys.
 */
export function extractStderrErrorHint(stderr: string): string | null {
	if (!stderr) return null;

	if (
		stderr.includes("API key is missing") ||
		stderr.includes("LoadAPIKeyError")
	) {
		return t("chat.acpErrors.stderrApiKeyMissing");
	}

	if (
		stderr.includes("authentication") ||
		stderr.includes("unauthorized") ||
		stderr.includes("401")
	) {
		return t("chat.acpErrors.stderrAuth");
	}

	return null;
}

/**
 * Check if error is a "user aborted" error that should be ignored.
 */
export function isUserAbortedError(error: unknown): boolean {
	const code = extractErrorCode(error);
	if (code !== AcpErrorCode.INTERNAL_ERROR) {
		return false;
	}

	const message = extractErrorMessage(error);
	return message.includes("user aborted");
}

// ============================================================================
// Process Error Functions
// ============================================================================

/**
 * Get error information for process spawn errors.
 */
export function getSpawnErrorInfo(
	error: Error,
	command: string,
	agentLabel: string,
	wslMode: boolean,
): { title: string; message: string; suggestion: string } {
	if ((error as NodeJS.ErrnoException).code === "ENOENT") {
		return {
			title: t("chat.acpErrors.cantStartTitle", { agent: agentLabel }),
			message: t("chat.acpErrors.notInstalled", {
				agent: agentLabel,
				command,
			}),
			suggestion: getCommandNotFoundSuggestion(command, wslMode),
		};
	}

	return {
		title: t("chat.acpErrors.startupErrorTitle"),
		message: t("chat.acpErrors.failedToStart", {
			agent: agentLabel,
			message: error.message,
		}),
		suggestion: t("chat.acpErrors.checkAgentConfig"),
	};
}

/**
 * Get platform-specific suggestions for command not found errors.
 */
export function getCommandNotFoundSuggestion(
	command: string,
	wslMode: boolean,
): string {
	const commandName =
		command.split("/").pop()?.split("\\").pop() || "command";

	if (Platform.isWin && wslMode) {
		return t("chat.acpErrors.pathHintWsl", { command: commandName });
	} else if (Platform.isWin) {
		return t("chat.acpErrors.pathHintWin", { command: commandName });
	} else {
		return t("chat.acpErrors.pathHintUnix", { command: commandName });
	}
}

// ============================================================================
// Startup errors with a known reason
// ============================================================================

/**
 * An agent failed to start for a reason the client recognized (D3: an older
 * kiro-cli without the V3 engine). Carries the text the chat shows, so
 * callers display it instead of a generic "Session Creation Failed".
 */
export class AgentStartupError extends Error {
	readonly info: ErrorInfo;
	constructor(info: ErrorInfo) {
		super(info.message);
		this.name = AgentStartupError.name;
		this.info = info;
	}
}

export function isAgentStartupError(error: unknown): error is AgentStartupError {
	return error instanceof AgentStartupError;
}

/**
 * An initialize that a disconnect or another initialize replaced while it
 * was still starting (the old-CLI relaunch, I270). The replacing call owns
 * the tab's state, so this one must not show an error over it.
 */
export class InitializeSupersededError extends Error {
	constructor() {
		super("Agent initialization was superseded");
		this.name = InitializeSupersededError.name;
	}
}

export function isInitializeSuperseded(
	error: unknown,
): error is InitializeSupersededError {
	return error instanceof InitializeSupersededError;
}
