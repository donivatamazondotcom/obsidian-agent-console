import * as React from "react";
import { t } from "../i18n";

interface Props {
	tabId: string;
	onError?: (tabId: string) => void;
	onRetry?: (tabId: string) => void;
	children: React.ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

/**
 * Error boundary that wraps each tab's ChatContextProvider + ChatPanel.
 * Catches render errors in a single tab without crashing the entire view.
 */
export class TabErrorBoundary extends React.Component<Props, State> {
	state: State = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error(
			`[Agent Console] Tab ${this.props.tabId} crashed:`,
			error,
			info.componentStack,
		);
		this.props.onError?.(this.props.tabId);
	}

	private handleRetry = () => {
		this.props.onRetry?.(this.props.tabId);
		this.setState({ hasError: false, error: null });
	};

	render() {
		if (this.state.hasError) {
			return (
				<div className="agent-client-tab-error">
					<div className="agent-client-tab-error-icon">⚠</div>
					<div className="agent-client-tab-error-title">
						{t("chat.errors.tabCrashTitle")}
					</div>
					<div className="agent-client-tab-error-message">
						{this.state.error?.message ?? t("notices.unknownError")}
					</div>
					<button
						className="agent-client-tab-error-retry"
						onClick={this.handleRetry}
					>
						{t("chat.errors.retry")}
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
