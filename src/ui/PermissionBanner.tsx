import { useEffect, useRef } from "react";
import { setTooltip } from "obsidian";
import { getLogger } from "../utils/logger";
import type { PermissionOption } from "../types/chat";

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

	if (!isActive || isSelected || isCancelled) return null;

	return (
		<div className="agent-client-message-permission-request">
			{permissionRequest.options.map((option) => (
				<PermissionOptionButton
					key={option.optionId}
					option={option}
					onSelect={() => {
						if (onOptionSelected) {
							onOptionSelected(option.optionId);
						}

						if (onApprovePermission) {
							void onApprovePermission(
								permissionRequest.requestId,
								option.optionId,
							);
						} else {
							logger.warn(
								"Cannot handle permission response: missing onApprovePermission callback",
							);
						}
					}}
				/>
			))}
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
	useEffect(() => {
		if (buttonRef.current) {
			setTooltip(buttonRef.current, option.name);
		}
	}, [option.name]);

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
