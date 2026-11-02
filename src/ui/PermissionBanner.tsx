import { useEffect, useRef, useState } from "react";
import { setTooltip } from "obsidian";
import { getLogger } from "../utils/logger";
import type { PermissionOption, PermissionScopeChoice, PermissionScopeOffer } from "../types/chat";
import { t } from "../i18n";

interface PermissionBannerProps {
	permissionRequest: {
		requestId: string;
		options: PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
		isActive?: boolean;
	};
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	choice?: PermissionScopeChoice,
) => Promise<void>;
	onOptionSelected?: (optionId: string) => void;
}

export function PermissionBanner({
	permissionRequest,
	onApprovePermission,
	onOptionSelected,
}: PermissionBannerProps) {
	const logger = getLogger();

	const isSelected = permissionRequest.selectedOptionId !== undefined;
	const isCancelled = permissionRequest.isCancelled === true;
	const isActive = permissionRequest.isActive !== false;

	// Kiro V3 (S5): a persistent option with a scope offer opens a scope step
	// first. Hooks run before the early return below.
	const [scoping, setScoping] = useState<PermissionOption | null>(null);

	if (!isActive || isSelected || isCancelled) return null;

	const send = (option: PermissionOption, choice?: PermissionScopeChoice) => {
		if (onOptionSelected) {
			onOptionSelected(option.optionId);
		}
		if (onApprovePermission) {
			if (choice) {
				void onApprovePermission(permissionRequest.requestId, option.optionId, choice);
			} else {
				void onApprovePermission(permissionRequest.requestId, option.optionId);
			}
		} else {
			logger.warn(
				"Cannot handle permission response: missing onApprovePermission callback",
			);
		}
	};

	if (scoping?.scopeOffer) {
		return (
			<PermissionScopeStep
				option={scoping}
				offer={scoping.scopeOffer}
				onConfirm={(choice) => send(scoping, choice)}
				onBack={() => setScoping(null)}
			/>
		);
	}

	return (
		<div className="agent-client-message-permission-request">
			{permissionRequest.options.map((option) => (
				<PermissionOptionButton
					key={option.optionId}
					option={option}
					onSelect={() => {
						if (option.scopeOffer) {
							setScoping(option);
							return;
						}
						send(option);
					}}
				/>
			))}
		</div>
	);
}

interface PermissionScopeStepProps {
	option: PermissionOption;
	offer: PermissionScopeOffer;
	onConfirm: (choice: PermissionScopeChoice) => void;
	onBack: () => void;
}

/**
 * Kiro V3 (S5, option a): how long a persistent choice lasts, and what it
 * covers. Defaults: this vault, this exact command. "This vault" is saved by
 * Kiro outside the vault (per-workspace permissions file); "everywhere" is
 * deliberately not offered from a click.
 */
function PermissionScopeStep({ option, offer, onConfirm, onBack }: PermissionScopeStepProps) {
	const [scope, setScope] = useState<PermissionScopeChoice["scope"]>(
		offer.workspace ? "workspace" : "session",
	);
	const [match, setMatch] = useState<PermissionScopeChoice["match"]>("exact");
	const name = useRef(`acp-scope-${Math.random().toString(36).slice(2)}`).current;

	return (
		<div className="agent-client-message-permission-request agent-client-permission-scope">
			{offer.workspace && (
				<fieldset className="agent-client-permission-scope-group">
					<legend>{t("chat.permission.rememberFor")}</legend>
					<label>
						<input
							type="radio"
							name={`${name}-scope`}
							checked={scope === "workspace"}
							onChange={() => setScope("workspace")}
						/>
						{t("chat.permission.thisVault")}
					</label>
					<label>
						<input
							type="radio"
							name={`${name}-scope`}
							checked={scope === "session"}
							onChange={() => setScope("session")}
						/>
						{t("chat.permission.thisChatOnly")}
					</label>
				</fieldset>
			)}
			{offer.pattern !== undefined && (
				<fieldset className="agent-client-permission-scope-group">
					<legend>{t("chat.permission.appliesTo")}</legend>
					<label>
						<input
							type="radio"
							name={`${name}-match`}
							checked={match === "exact"}
							onChange={() => setMatch("exact")}
						/>
						{t("chat.permission.exactCommand")} <code>{offer.resource}</code>
					</label>
					<label>
						<input
							type="radio"
							name={`${name}-match`}
							checked={match === "pattern"}
							onChange={() => setMatch("pattern")}
						/>
						{t("chat.permission.patternCommands")} <code>{offer.pattern}</code>
					</label>
				</fieldset>
			)}
			{scope === "workspace" && (
				<div className="agent-client-permission-scope-note">{t("chat.permission.vaultNote")}</div>
			)}
			<div className="agent-client-permission-scope-actions">
				<button
					type="button"
					className={`agent-client-permission-option agent-client-permission-kind-${option.kind}`}
					onClick={() => onConfirm({ scope, match: offer.pattern !== undefined ? match : "exact" })}
				>
					<span className="agent-client-permission-option-label">{option.name}</span>
				</button>
				<button type="button" className="agent-client-permission-option" onClick={onBack}>
					<span className="agent-client-permission-option-label">{t("chat.permission.back")}</span>
				</button>
			</div>
		</div>
	);
}

interface PermissionOptionButtonProps {
	option: PermissionOption;
	onSelect: () => void;
}

function PermissionOptionButton({
	option,
	onSelect,
}: PermissionOptionButtonProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);

	// The option name can be very long (e.g. "Always Allow Bash(<long
	// command>), Read(<glob>)"). The label span is CSS-truncated so the
	// button never overflows a narrow sidebar; reveal the full text on hover
	// with Obsidian's setTooltip — the sanctioned themed-tooltip mechanism,
	// consistent with TabBar / ChatHeader / SettingsTab (not a raw `title`).
	const tooltip = option.name;
	useEffect(() => {
		if (buttonRef.current) {
			setTooltip(buttonRef.current, tooltip);
		}
	}, [tooltip]);

	return (
		<button
			ref={buttonRef}
			className={`agent-client-permission-option ${option.kind ? `agent-client-permission-kind-${option.kind}` : ""}`}
			onClick={onSelect}
		>
			<span className="agent-client-permission-option-label">
				{option.name}
			</span>
		</button>
	);
}
