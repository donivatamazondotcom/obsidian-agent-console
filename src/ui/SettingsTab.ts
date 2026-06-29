import {
	App,
	PluginSettingTab,
	Setting,
	DropdownComponent,
	Platform,
	SecretComponent,
	Notice,
	FileSystemAdapter,
} from "obsidian";
import type AgentClientPlugin from "../plugin";
import type {
	CustomAgentSettings,
	AgentEnvVar,
	ChatViewLocation,
} from "../plugin";
import { resolveCommandPath, resolveCommandPathInWsl } from "../utils/paths";
import { pickFolder } from "../utils/folder-picker";
import {
	resolveDefaultWorkingDirectory,
	resolveAgentWorkingDirectory,
} from "../utils/working-directory";
import {
	TITLE_STRATEGY_OPTIONS,
	type TitleStrategy,
} from "../types/title-strategy";
import {
	AgentExpansionState,
	freshAgentExpansion,
	syncAgentExpansion,
	toggleAgentExpansion,
} from "../utils/agent-expansion";
import {
	normalizeEnvVars,
	CHAT_FONT_SIZE_MAX,
	CHAT_FONT_SIZE_MIN,
	parseChatFontSize,
	parseComputedFontSizePx,
} from "../services/settings-normalizer";
import {
	collectAgentIdsExcept,
	resolveUniqueAgentId,
} from "../services/session-helpers";
import { deriveImportPlacement } from "../utils/settings-layout";

export class AgentClientSettingTab extends PluginSettingTab {
	plugin: AgentClientPlugin;
	private agentSelector: DropdownComponent | null = null;
	private unsubscribe: (() => void) | null = null;
	private agentExpansion: AgentExpansionState = freshAgentExpansion();
	/**
	 * Agent id whose first field should grab focus on the next render — set
	 * when "Add custom agent" creates an agent, consumed (cleared) when that
	 * agent's Agent ID field renders. Per-session UI intent, not persisted.
	 */
	private pendingFocusAgentId: string | null = null;

	constructor(app: App, plugin: AgentClientPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		this.agentSelector = null;

		// Cleanup previous subscription if exists
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}

		const importPlacement = deriveImportPlacement(
			this.plugin.settings.hasCompletedSetup,
		);

		// ── Top matter (ungrouped) ──
		// A Settings search input slot is reserved here for member #5 of the
		// Settings Pane Overhaul (not yet built).
		// D5: Import settings shows here on a fresh/un-configured install (the
		// moment you'd import from another machine); once set up it moves to
		// Advanced.
		if (importPlacement === "top-matter") {
			this.renderImportSetting(containerEl);
		}

		// Documentation link
		const docContainer = containerEl.createDiv({
			cls: "agent-client-doc-link",
		});
		docContainer.createSpan({ text: "Need help? Check out the " });
		docContainer.createEl("a", {
			text: "documentation",
			href: "https://donivatamazondotcom.github.io/obsidian-agent-console/",
			attr: { target: "_blank" },
		});
		docContainer.createSpan({ text: "." });

		new Setting(containerEl).setName("Agents").setHeading();

		this.renderAgentSelector(containerEl);

		// Subscribe to settings changes to update agent dropdown
		this.unsubscribe = this.plugin.settingsService.subscribe(() => {
			this.updateAgentDropdown();
		});
		// Also update immediately on display to sync with current settings
		this.updateAgentDropdown();

		// Default working directory — global default new chats launch in.
		const resolveVaultRoot = (): string => {
			const adapter = this.plugin.app.vault.adapter;
			return adapter instanceof FileSystemAdapter
				? adapter.getBasePath()
				: "";
		};
		const describeCwd = (value: string): string => {
			const vaultRoot = resolveVaultRoot();
			const base =
				"Directory new chats start in. Leave blank to use the vault root. Existing and restored chats keep their own directory.";
			if (!value.trim()) {
				return `${base} Currently: vault root${vaultRoot ? ` (${vaultRoot})` : ""}.`;
			}
			const resolved = resolveDefaultWorkingDirectory(value, vaultRoot);
			if (resolved.fellBack) {
				return `${base} ⚠ "${value}" is not a valid absolute directory — new chats will use the vault root${vaultRoot ? ` (${vaultRoot})` : ""}.`;
			}
			return `${base} Resolved: ${resolved.dir}.`;
		};
		const cwdSetting = new Setting(containerEl)
			.setName("Default working directory")
			.setDesc(describeCwd(this.plugin.settings.defaultWorkingDirectory));
		cwdSetting.addText((text) =>
			text
				.setPlaceholder("Leave blank for vault root")
				.setValue(this.plugin.settings.defaultWorkingDirectory)
				.onChange(async (value) => {
					await this.plugin.settingsService.updateSettings({
						defaultWorkingDirectory: value.trim(),
					});
					cwdSetting.setDesc(describeCwd(value));
				}),
		);
		cwdSetting.addButton((btn) =>
			btn
				.setButtonText("Browse…")
				.setTooltip("Choose a folder")
				.onClick(async () => {
					const picked = await pickFolder({
						title: "Select default working directory",
						defaultPath:
							this.plugin.settings.defaultWorkingDirectory ||
							resolveVaultRoot(),
					});
					if (picked) {
						await this.plugin.settingsService.updateSettings({
							defaultWorkingDirectory: picked,
						});
						this.display();
					}
				}),
		);

		new Setting(containerEl).setName("Built-in agents").setHeading();

		this.agentExpansion = syncAgentExpansion(
			this.agentExpansion,
			this.plugin.settings.defaultAgentId,
		);
		this.renderCollapsibleAgentSection(
			containerEl,
			this.plugin.settings.claude.id,
			this.plugin.settings.claude.displayName || "Claude Code",
			(el) => this.renderClaudeSettings(el),
		);
		this.renderCollapsibleAgentSection(
			containerEl,
			this.plugin.settings.codex.id,
			this.plugin.settings.codex.displayName || "Codex",
			(el) => this.renderCodexSettings(el),
		);
		this.renderCollapsibleAgentSection(
			containerEl,
			this.plugin.settings.gemini.id,
			this.plugin.settings.gemini.displayName || "Gemini CLI",
			(el) => this.renderGeminiSettings(el),
		);
		this.renderCollapsibleAgentSection(
			containerEl,
			this.plugin.settings.kiro.id,
			this.plugin.settings.kiro.displayName || "Kiro CLI",
			(el) => this.renderKiroSettings(el),
		);

		new Setting(containerEl).setName("Custom agents").setHeading();

		this.renderCustomAgents(containerEl);

		new Setting(containerEl).setName("Chat behavior").setHeading();

		new Setting(containerEl)
			.setName("Active note as default context")
			.setDesc(
				"Automatically add the active note to a new chat's context strip. You can always pin notes manually with the grab button.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.activeNoteAsDefaultContext)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							activeNoteAsDefaultContext: value,
						});
					}),
			);

		new Setting(containerEl)
			.setName("Session title")
			.setDesc(
				"How a new chat's tab label is generated. Agent-suggested asks the agent for a short title on its first reply and falls back to your first message while it arrives. You can always rename a tab manually.",
			)
			.addDropdown((dropdown) => {
				for (const { value, label } of TITLE_STRATEGY_OPTIONS) {
					dropdown.addOption(value, label);
				}
				dropdown
					.setValue(this.plugin.settings.titleStrategy)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							titleStrategy: value as TitleStrategy,
						});
					});
			});

		new Setting(containerEl)
			.setName("Quick prompts folder")
			.setDesc(
				"Vault folder scanned for quick prompts — one markdown note per prompt. The note's description (or name/title/filename) is the label; the body is the prompt text. Changes are picked up live.",
			)
			.addText((text) => {
				text.setPlaceholder("Quick Prompts")
					.setValue(this.plugin.settings.quickPromptsFolder)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							quickPromptsFolder: value.trim(),
						});
						void this.plugin.quickPromptLibrary.rescan();
					});
			});

		new Setting(containerEl)
			.setName("Send message shortcut")
			.setDesc(
				"Choose the keyboard shortcut to send messages. Note: If using Cmd/Ctrl+Enter, you may need to remove any hotkeys assigned to Cmd/Ctrl+Enter (Settings → Hotkeys).",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(
						"enter",
						"Enter to send, Shift+Enter for newline",
					)
					.addOption(
						"cmd-enter",
						"Cmd/Ctrl+Enter to send, Enter for newline",
					)
					.setValue(this.plugin.settings.sendMessageShortcut)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							sendMessageShortcut: value as "enter" | "cmd-enter",
						});
					}),
			);

		new Setting(containerEl)
			.setName("Appearance & notifications")
			.setHeading();

		new Setting(containerEl)
			.setName("Sidebar side")
			.setDesc("Which sidebar new chat views open in")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("right", "Right sidebar")
					.addOption("left", "Left sidebar")
					.setValue(this.plugin.settings.chatViewLocation)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							chatViewLocation: value as ChatViewLocation,
						});
					}),
			);

		new Setting(containerEl)
			.setName("Chat font size")
			.setDesc(
				`Adjust the font size of the chat message area (${CHAT_FONT_SIZE_MIN}-${CHAT_FONT_SIZE_MAX}px).`,
			)
			.addText((text) => {
				const getCurrentDisplayValue = (): string => {
					const currentFontSize =
						this.plugin.settings.displaySettings.fontSize;
					return currentFontSize === null
						? ""
						: String(currentFontSize);
				};

				// When no explicit size is set (fontSize === null), the field
				// is empty and the chat area follows whatever the active theme
				// resolves --ac-chat-font-size to (the plugin default is
				// var(--font-text-size), but themes/snippets can scale it, e.g.
				// calc(var(--font-text-size) * 0.85)). Reading --font-text-size
				// directly would report the wrong number, so measure the real
				// resolved size off an off-screen replica that uses the same
				// chat-view classes, and surface it in the placeholder.
				const getEffectiveChatFontSizePx = (): number | null => {
					const probe = document.createElement("div");
					probe.addClass("agent-client-chat-view-container");
					probe.addClass("agent-client-font-size-probe");
					const messages = document.createElement("div");
					messages.addClass("agent-client-chat-view-messages");
					probe.appendChild(messages);
					document.body.appendChild(probe);
					const computedFontSize =
						getComputedStyle(messages).fontSize;
					probe.remove();
					return parseComputedFontSizePx(computedFontSize);
				};

				const getPlaceholder = (): string => {
					const effectivePx = getEffectiveChatFontSizePx();
					return effectivePx === null
						? `${CHAT_FONT_SIZE_MIN}-${CHAT_FONT_SIZE_MAX}`
						: `${effectivePx} (current)`;
				};

				const persistChatFontSize = async (
					fontSize: number | null,
				): Promise<void> => {
					if (
						this.plugin.settings.displaySettings.fontSize ===
						fontSize
					) {
						return;
					}

					const nextSettings = {
						...this.plugin.settings,
						displaySettings: {
							...this.plugin.settings.displaySettings,
							fontSize,
						},
					};
					await this.plugin.saveSettingsAndNotify(nextSettings);
				};

				text.setPlaceholder(getPlaceholder())
					.setValue(getCurrentDisplayValue())
					.onChange(async (value) => {
						if (value.trim().length === 0) {
							await persistChatFontSize(null);
							return;
						}

						const trimmedValue = value.trim();
						if (!/^-?\d+$/.test(trimmedValue)) {
							return;
						}

						const numericValue = Number.parseInt(trimmedValue, 10);
						if (
							numericValue < CHAT_FONT_SIZE_MIN ||
							numericValue > CHAT_FONT_SIZE_MAX
						) {
							return;
						}

						const parsedFontSize = parseChatFontSize(numericValue);
						if (parsedFontSize === null) {
							return;
						}

						const hasChanged =
							this.plugin.settings.displaySettings.fontSize !==
							parsedFontSize;
						if (hasChanged) {
							await persistChatFontSize(parsedFontSize);
						}
					});

				text.inputEl.addEventListener("blur", () => {
					const currentInputValue = text.getValue();
					const parsedFontSize = parseChatFontSize(currentInputValue);

					if (
						currentInputValue.trim().length > 0 &&
						parsedFontSize === null
					) {
						text.setValue(getCurrentDisplayValue());
						return;
					}

					if (parsedFontSize !== null) {
						text.setValue(String(parsedFontSize));
						const hasChanged =
							this.plugin.settings.displaySettings.fontSize !==
							parsedFontSize;
						if (hasChanged) {
							void persistChatFontSize(parsedFontSize);
						}
						return;
					}

					text.setValue("");
				});
			});

		new Setting(containerEl)
			.setName("Show emojis")
			.setDesc(
				"Display emoji icons in tool calls, thoughts, plans, and terminal blocks.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.displaySettings.showEmojis)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							displaySettings: {
								...this.plugin.settings.displaySettings,
								showEmojis: value,
							},
						});
					}),
			);

		new Setting(containerEl)
			.setName("System notifications")
			.setDesc(
				"Show a notification when the agent finishes a reply or asks for permission. Completion notifications name the tab and switch to it when clicked. Notifications stay quiet while Obsidian is focused.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableSystemNotifications)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							enableSystemNotifications: value,
						});
					}),
			);

		new Setting(containerEl).setName("Tabs").setHeading();

		new Setting(containerEl)
			.setName("Restore tabs on startup")
			.setDesc(
				"Save open tabs when Obsidian quits and restore them on next launch. Each view restores its own tabs independently.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.restoreTabsOnStartup)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							restoreTabsOnStartup: value,
						});
					}),
			);

		new Setting(containerEl)
			.setName("Confirm before closing multiple chats")
			.setDesc(
				"Warn before closing the panel with Cmd+W when it has 2 or more open chats, so you don't lose several running agents at once.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.confirmCloseWithMultipleTabs)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							confirmCloseWithMultipleTabs: value,
						});
					}),
			);

		new Setting(containerEl).setName("Permissions").setHeading();

		new Setting(containerEl)
			.setName("Auto-allow permissions")
			.setDesc(
				"Automatically allow all permission requests from agents. ⚠️ Use with caution - this gives agents full access to your system.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAllowPermissions)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							autoAllowPermissions: value,
						});
						// Propagate to all live AcpClient instances
						this.plugin.updateAllAutoAllow(value);
					}),
			);

		this.renderCollapsibleSection(containerEl, "Export", (containerEl) => {
			new Setting(containerEl)
				.setName("Export folder")
				.setDesc("Folder where chat exports will be saved")
				.addText((text) =>
					text
						.setPlaceholder("Agent Console")
						.setValue(
							this.plugin.settings.exportSettings.defaultFolder,
						)
						.onChange(async (value) => {
							await this.plugin.settingsService.updateSettings({
								exportSettings: {
									...this.plugin.settings.exportSettings,
									defaultFolder: value,
								},
							});
						}),
				);

			new Setting(containerEl)
				.setName("Filename")
				.setDesc(
					"Template for exported filenames. Use {date} for date and {time} for time",
				)
				.addText((text) =>
					text
						.setPlaceholder("agent_console_{date}_{time}")
						.setValue(
							this.plugin.settings.exportSettings
								.filenameTemplate,
						)
						.onChange(async (value) => {
							await this.plugin.settingsService.updateSettings({
								exportSettings: {
									...this.plugin.settings.exportSettings,
									filenameTemplate: value,
								},
							});
						}),
				);

			new Setting(containerEl)
				.setName("Frontmatter tag")
				.setDesc(
					"Tag to add to exported notes. Supports nested tags (e.g., projects/agent-console). Leave empty to disable.",
				)
				.addText((text) =>
					text
						.setPlaceholder("agent-console")
						.setValue(
							this.plugin.settings.exportSettings.frontmatterTag,
						)
						.onChange(async (value) => {
							await this.plugin.settingsService.updateSettings({
								exportSettings: {
									...this.plugin.settings.exportSettings,
									frontmatterTag: value,
								},
							});
						}),
				);

			new Setting(containerEl)
				.setName("Include images")
				.setDesc("Include images in exported markdown files")
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.exportSettings.includeImages,
						)
						.onChange(async (value) => {
							await this.plugin.settingsService.updateSettings({
								exportSettings: {
									...this.plugin.settings.exportSettings,
									includeImages: value,
								},
							});
							this.display();
						}),
				);

			if (this.plugin.settings.exportSettings.includeImages) {
				new Setting(containerEl)
					.setName("Image location")
					.setDesc("Where to save exported images")
					.addDropdown((dropdown) =>
						dropdown
							.addOption(
								"obsidian",
								"Use Obsidian's attachment setting",
							)
							.addOption("custom", "Save to custom folder")
							.addOption(
								"base64",
								"Embed as Base64 (not recommended)",
							)
							.setValue(
								this.plugin.settings.exportSettings
									.imageLocation,
							)
							.onChange(async (value) => {
								await this.plugin.settingsService.updateSettings(
									{
										exportSettings: {
											...this.plugin.settings
												.exportSettings,
											imageLocation: value as
												| "obsidian"
												| "custom"
												| "base64",
										},
									},
								);
								this.display();
							}),
					);

				if (
					this.plugin.settings.exportSettings.imageLocation ===
					"custom"
				) {
					new Setting(containerEl)
						.setName("Custom image folder")
						.setDesc(
							"Folder path for exported images (relative to vault root)",
						)
						.addText((text) =>
							text
								.setPlaceholder("Agent Console")
								.setValue(
									this.plugin.settings.exportSettings
										.imageCustomFolder,
								)
								.onChange(async (value) => {
									await this.plugin.settingsService.updateSettings(
										{
											exportSettings: {
												...this.plugin.settings
													.exportSettings,
												imageCustomFolder: value,
											},
										},
									);
								}),
						);
				}
			}

			new Setting(containerEl)
				.setName("Auto-export on new chat")
				.setDesc(
					"Automatically export the current chat when starting a new chat",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.exportSettings
								.autoExportOnNewChat,
						)
						.onChange(async (value) => {
							await this.plugin.settingsService.updateSettings({
								exportSettings: {
									...this.plugin.settings.exportSettings,
									autoExportOnNewChat: value,
								},
							});
						}),
				);

			new Setting(containerEl)
				.setName("Auto-export on close chat")
				.setDesc(
					"Automatically export the current chat when closing the chat view",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.exportSettings
								.autoExportOnCloseChat,
						)
						.onChange(async (value) => {
							await this.plugin.settingsService.updateSettings({
								exportSettings: {
									...this.plugin.settings.exportSettings,
									autoExportOnCloseChat: value,
								},
							});
						}),
				);

			new Setting(containerEl)
				.setName("Open note after export")
				.setDesc("Automatically open the exported note after exporting")
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.exportSettings
								.openFileAfterExport,
						)
						.onChange(async (value) => {
							await this.plugin.settingsService.updateSettings({
								exportSettings: {
									...this.plugin.settings.exportSettings,
									openFileAfterExport: value,
								},
							});
						}),
				);
		});

		this.renderCollapsibleSection(
			containerEl,
			"Advanced",
			(containerEl) => {
				const nodePathSetting = new Setting(containerEl)
					.setName("Node.js path")
					.setDesc(
						"Path to Node.js. Usually leave blank. Only needed if node is in a non-standard location (enter absolute path, e.g. /usr/local/bin/node).",
					)
					.addText((text) => {
						text.setPlaceholder(
							"Leave blank (login shell auto-resolves)",
						)
							.setValue(this.plugin.settings.nodePath)
							.onChange(async (value) => {
								await this.plugin.settingsService.updateSettings(
									{
										nodePath: value.trim(),
									},
								);
							});
					});
				this.addAutoDetectButton(
					nodePathSetting,
					"node",
					async (path) => {
						await this.plugin.settingsService.updateSettings({
							nodePath: path,
						});
					},
				);

				if (Platform.isWin) {
					new Setting(containerEl)
						.setName("Windows Subsystem for Linux")
						.setHeading();

					new Setting(containerEl)
						.setName("Enable WSL mode")
						.setDesc(
							"Run agents inside Windows Subsystem for Linux. Recommended for agents like Codex that don't work well in native Windows environments.",
						)
						.addToggle((toggle) =>
							toggle
								.setValue(this.plugin.settings.windowsWslMode)
								.onChange(async (value) => {
									await this.plugin.settingsService.updateSettings(
										{
											windowsWslMode: value,
										},
									);
									this.display(); // Refresh to show/hide distribution setting
								}),
						);

					if (this.plugin.settings.windowsWslMode) {
						new Setting(containerEl)
							.setName("WSL distribution")
							.setDesc(
								"Specify WSL distribution name (leave empty for default). Example: Ubuntu, Debian",
							)
							.addText((text) =>
								text
									.setPlaceholder("Leave empty for default")
									.setValue(
										this.plugin.settings
											.windowsWslDistribution || "",
									)
									.onChange(async (value) => {
										await this.plugin.settingsService.updateSettings(
											{
												windowsWslDistribution:
													value.trim() || undefined,
											},
										);
									}),
							);
					}
				}

				new Setting(containerEl)
					.setName("Debug mode")
					.setDesc(
						"Enable debug logging to console. Useful for development and troubleshooting.",
					)
					.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings.debugMode)
							.onChange(async (value) => {
								await this.plugin.settingsService.updateSettings(
									{
										debugMode: value,
									},
								);
							}),
					);

				// D5: once configured, Import settings lives here in Advanced.
				if (importPlacement === "advanced") {
					this.renderImportSetting(containerEl);
				}
			},
		);
	}

	/**
	 * Update the agent dropdown when settings change.
	 * Only updates if the value is different to avoid infinite loops.
	 */
	private updateAgentDropdown(): void {
		if (!this.agentSelector) {
			return;
		}

		// Get latest settings from store snapshot
		const settings = this.plugin.settingsService.getSnapshot();
		const currentValue = this.agentSelector.getValue();

		// Only update if different to avoid triggering onChange
		if (settings.defaultAgentId !== currentValue) {
			this.agentSelector.setValue(settings.defaultAgentId);
		}
	}

	/**
	 * Called when the settings tab is hidden.
	 * Clean up subscriptions to prevent memory leaks.
	 */
	hide(): void {
		// Reset per-session expansion so reopening the tab shows only the
		// default agent expanded (Collapsible Agent Sections, T04 / Decision 3).
		this.agentExpansion = freshAgentExpansion();
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
	}

	private renderAgentSelector(containerEl: HTMLElement) {
		this.plugin.ensureDefaultAgentId();

		new Setting(containerEl)
			.setName("Default agent")
			.setDesc("Choose which agent is used when opening a new chat view.")
			.addDropdown((dropdown) => {
				this.agentSelector = dropdown;
				this.populateAgentDropdown(dropdown);
				dropdown.setValue(this.plugin.settings.defaultAgentId);
				dropdown.onChange(async (value) => {
					const nextSettings = {
						...this.plugin.settings,
						defaultAgentId: value,
					};
					this.plugin.ensureDefaultAgentId();
					await this.plugin.saveSettingsAndNotify(nextSettings);
					// Re-render so the collapsible auto-expand follows the new
					// default agent (Collapsible Agent Sections, T03).
					this.display();
				});
			});
	}

	private populateAgentDropdown(dropdown: DropdownComponent) {
		dropdown.selectEl.empty();
		for (const option of this.getAgentOptions()) {
			dropdown.addOption(option.id, option.label);
		}
	}

	private refreshAgentDropdown() {
		if (!this.agentSelector) {
			return;
		}
		this.populateAgentDropdown(this.agentSelector);
		this.agentSelector.setValue(this.plugin.settings.defaultAgentId);
	}

	private getAgentOptions(): { id: string; label: string }[] {
		const toOption = (id: string, displayName: string) => ({
			id,
			label: `${displayName} (${id})`,
		});
		const options: { id: string; label: string }[] = [
			toOption(
				this.plugin.settings.claude.id,
				this.plugin.settings.claude.displayName ||
					this.plugin.settings.claude.id,
			),
			toOption(
				this.plugin.settings.codex.id,
				this.plugin.settings.codex.displayName ||
					this.plugin.settings.codex.id,
			),
			toOption(
				this.plugin.settings.gemini.id,
				this.plugin.settings.gemini.displayName ||
					this.plugin.settings.gemini.id,
			),
			toOption(
				this.plugin.settings.kiro.id,
				this.plugin.settings.kiro.displayName ||
					this.plugin.settings.kiro.id,
			),
		];
		for (const agent of this.plugin.settings.customAgents) {
			if (agent.id && agent.id.length > 0) {
				const labelSource =
					agent.displayName && agent.displayName.length > 0
						? agent.displayName
						: agent.id;
				options.push(toOption(agent.id, labelSource));
			}
		}
		const seen = new Set<string>();
		return options.filter(({ id }) => {
			if (seen.has(id)) {
				return false;
			}
			seen.add(id);
			return true;
		});
	}

	private renderGeminiSettings(sectionEl: HTMLElement) {
		const gemini = this.plugin.settings.gemini;

		new Setting(sectionEl)
			.setName("API key")
			.setDesc(
				"Gemini API key. Required if not logging in with a Google account. Select from Obsidian's Keychain or create a new secret.",
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(gemini.apiKeySecretId)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							gemini: {
								...this.plugin.settings.gemini,
								apiKeySecretId: value,
							},
						});
					}),
			);

		const geminiPathSetting = new Setting(sectionEl)
			.setName("Path")
			.setDesc(
				'Command name or path to the Gemini CLI. Use just "gemini" to let the login shell resolve it, or enter an absolute path for a specific version.',
			)
			.addText((text) => {
				text.setPlaceholder("gemini")
					.setValue(gemini.command)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							gemini: {
								...this.plugin.settings.gemini,
								command: value.trim(),
							},
						});
					});
			});
		this.addAutoDetectButton(geminiPathSetting, "gemini", async (path) => {
			await this.plugin.settingsService.updateSettings({
				gemini: {
					...this.plugin.settings.gemini,
					command: path,
				},
			});
		});
		this.addInstallHint(sectionEl, "@google/gemini-cli");

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				'Enter one argument per line. Leave empty to run without arguments.(Currently, the Gemini CLI requires the "--experimental-acp" option.)',
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatArgs(gemini.args))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							gemini: {
								...this.plugin.settings.gemini,
								args: this.parseArgs(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. Required to authenticate with Vertex AI. GEMINI_API_KEY is derived from the field above.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("GOOGLE_CLOUD_PROJECT=...")
					.setValue(this.formatEnv(gemini.env))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							gemini: {
								...this.plugin.settings.gemini,
								env: this.parseEnv(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		this.addAgentWorkingDirectoryRow(
			sectionEl,
			() => this.plugin.settings.gemini.defaultWorkingDirectory ?? "",
			async (value) => {
				await this.plugin.settingsService.updateSettings({
					gemini: {
						...this.plugin.settings.gemini,
						defaultWorkingDirectory: value,
					},
				});
			},
		);
	}

	private renderKiroSettings(sectionEl: HTMLElement) {
		const kiro = this.plugin.settings.kiro;

		new Setting(sectionEl)
			.setName("Authentication")
			.setDesc(
				'Kiro CLI signs in with your Kiro account, so no API key is needed. Run "kiro-cli" once in a terminal to sign in, then select Kiro CLI here.',
			);

		const kiroPathSetting = new Setting(sectionEl)
			.setName("Path")
			.setDesc(
				'Command name or path to kiro-cli. Use just "kiro-cli" to let the login shell resolve it, or enter an absolute path (commonly ~/.local/bin/kiro-cli).',
			)
			.addText((text) => {
				text.setPlaceholder("kiro-cli")
					.setValue(kiro.command)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							kiro: {
								...this.plugin.settings.kiro,
								command: value.trim(),
							},
						});
					});
			});
		this.addAutoDetectButton(kiroPathSetting, "kiro-cli", async (path) => {
			await this.plugin.settingsService.updateSettings({
				kiro: {
					...this.plugin.settings.kiro,
					command: path,
				},
			});
		});

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				'Enter one argument per line. Kiro CLI requires the "acp" subcommand.',
			)
			.addTextArea((text) => {
				text.setPlaceholder("acp")
					.setValue(this.formatArgs(kiro.args))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							kiro: {
								...this.plugin.settings.kiro,
								args: this.parseArgs(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. Leave empty unless your setup requires it.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatEnv(kiro.env))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							kiro: {
								...this.plugin.settings.kiro,
								env: this.parseEnv(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		this.addAgentWorkingDirectoryRow(
			sectionEl,
			() => this.plugin.settings.kiro.defaultWorkingDirectory ?? "",
			async (value) => {
				await this.plugin.settingsService.updateSettings({
					kiro: {
						...this.plugin.settings.kiro,
						defaultWorkingDirectory: value,
					},
				});
			},
		);
	}

	private renderClaudeSettings(sectionEl: HTMLElement) {
		const claude = this.plugin.settings.claude;

		new Setting(sectionEl)
			.setName("API key")
			.setDesc(
				"Anthropic API key. Required if not logging in with an Anthropic account. Select from Obsidian's Keychain or create a new secret.",
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(claude.apiKeySecretId)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							claude: {
								...this.plugin.settings.claude,
								apiKeySecretId: value,
							},
						});
					}),
			);

		const claudePathSetting = new Setting(sectionEl)
			.setName("Path")
			.setDesc(
				'Command name or path to claude-agent-acp. Use just "claude-agent-acp" to let the login shell resolve it, or enter an absolute path.',
			)
			.addText((text) => {
				text.setPlaceholder("claude-agent-acp")
					.setValue(claude.command)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							claude: {
								...this.plugin.settings.claude,
								command: value.trim(),
							},
						});
					});
			});
		this.addAutoDetectButton(
			claudePathSetting,
			"claude-agent-acp",
			async (path) => {
				await this.plugin.settingsService.updateSettings({
					claude: {
						...this.plugin.settings.claude,
						command: path,
					},
				});
			},
		);
		this.addInstallHint(sectionEl, "@agentclientprotocol/claude-agent-acp");

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatArgs(claude.args))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							claude: {
								...this.plugin.settings.claude,
								args: this.parseArgs(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. ANTHROPIC_API_KEY is derived from the field above.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatEnv(claude.env))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							claude: {
								...this.plugin.settings.claude,
								env: this.parseEnv(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		this.addAgentWorkingDirectoryRow(
			sectionEl,
			() => this.plugin.settings.claude.defaultWorkingDirectory ?? "",
			async (value) => {
				await this.plugin.settingsService.updateSettings({
					claude: {
						...this.plugin.settings.claude,
						defaultWorkingDirectory: value,
					},
				});
			},
		);
	}

	private renderCodexSettings(sectionEl: HTMLElement) {
		const codex = this.plugin.settings.codex;

		new Setting(sectionEl)
			.setName("API key")
			.setDesc(
				"OpenAI API key. Required if not logging in with an OpenAI account. Select from Obsidian's Keychain or create a new secret.",
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(codex.apiKeySecretId)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							codex: {
								...this.plugin.settings.codex,
								apiKeySecretId: value,
							},
						});
					}),
			);

		const codexPathSetting = new Setting(sectionEl)
			.setName("Path")
			.setDesc(
				'Command name or path to codex-acp. Use just "codex-acp" to let the login shell resolve it, or enter an absolute path.',
			)
			.addText((text) => {
				text.setPlaceholder("codex-acp")
					.setValue(codex.command)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							codex: {
								...this.plugin.settings.codex,
								command: value.trim(),
							},
						});
					});
			});
		this.addAutoDetectButton(
			codexPathSetting,
			"codex-acp",
			async (path) => {
				await this.plugin.settingsService.updateSettings({
					codex: {
						...this.plugin.settings.codex,
						command: path,
					},
				});
			},
		);
		this.addInstallHint(sectionEl, "@zed-industries/codex-acp");

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatArgs(codex.args))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							codex: {
								...this.plugin.settings.codex,
								args: this.parseArgs(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. OPENAI_API_KEY is derived from the field above.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatEnv(codex.env))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							codex: {
								...this.plugin.settings.codex,
								env: this.parseEnv(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		this.addAgentWorkingDirectoryRow(
			sectionEl,
			() => this.plugin.settings.codex.defaultWorkingDirectory ?? "",
			async (value) => {
				await this.plugin.settingsService.updateSettings({
					codex: {
						...this.plugin.settings.codex,
						defaultWorkingDirectory: value,
					},
				});
			},
		);
	}

	private renderCustomAgents(containerEl: HTMLElement) {
		if (this.plugin.settings.customAgents.length === 0) {
			containerEl.createEl("p", {
				text: "No custom agents configured yet.",
				cls: "agent-client-empty-state",
			});
		} else {
			this.plugin.settings.customAgents.forEach((agent, index) => {
				this.renderCollapsibleAgentSection(
					containerEl,
					agent.id,
					agent.displayName || agent.id,
					(el) => this.renderCustomAgent(el, agent, index),
				);
			});
		}

		new Setting(containerEl).addButton((button) => {
			button
				.setButtonText("Add custom agent")
				.setCta()
				.onClick(async () => {
					const newId = this.generateCustomAgentId();
					const newDisplayName =
						this.generateCustomAgentDisplayName();
					this.plugin.settings.customAgents.push({
						id: newId,
						displayName: newDisplayName,
						command: "",
						args: [],
						env: [],
					});
					// Auto-expand the new section and focus its first field so the
					// user can start typing immediately — no extra click to open
					// the accordion.
					this.agentExpansion = toggleAgentExpansion(
						this.agentExpansion,
						newId,
						true,
					);
					this.pendingFocusAgentId = newId;
					this.plugin.ensureDefaultAgentId();
					await this.flushSettings();
					this.display();
				});
		});
	}

	private renderCustomAgent(
		containerEl: HTMLElement,
		agent: CustomAgentSettings,
		index: number,
	) {
		const blockEl = containerEl.createDiv({
			cls: "agent-client-custom-agent",
		});

		const idSetting = new Setting(blockEl)
			.setName("Agent ID")
			.setDesc("Unique identifier used to reference this agent.")
			.addText((text) => {
				text.setPlaceholder("custom-agent")
					.setValue(agent.id)
					.onChange(async (value) => {
						const previousId =
							this.plugin.settings.customAgents[index].id;
						const trimmed = value.trim();
						let nextId = trimmed;
						if (nextId.length === 0) {
							nextId = this.generateCustomAgentId();
							text.setValue(nextId);
						}
						this.plugin.settings.customAgents[index].id = nextId;
						if (
							this.plugin.settings.defaultAgentId === previousId
						) {
							this.plugin.settings.defaultAgentId = nextId;
						}
						this.plugin.ensureDefaultAgentId();
						await this.flushSettings();
						this.refreshAgentDropdown();
					});
				// Enforce id uniqueness on blur (not per-keystroke, so typing
				// isn't fought). An id colliding a built-in or another custom
				// agent is auto-suffixed; without this the colliding custom
				// agent is shadowed by findAgentSettings and unreachable (I105).
				text.inputEl.addEventListener("blur", () => {
					void (async () => {
						const current =
							this.plugin.settings.customAgents[index];
						if (!current) return;
						const previousId = current.id;
						let desired = text.getValue().trim();
						if (desired.length === 0) {
							desired = this.generateCustomAgentId();
						}
						const taken = collectAgentIdsExcept(
							this.plugin.settings,
							index,
						);
						const unique = resolveUniqueAgentId(desired, taken);
						if (unique === previousId) return;
						if (unique !== desired) {
							new Notice(
								`Agent ID "${desired}" is already in use — changed to "${unique}".`,
							);
						}
						text.setValue(unique);
						current.id = unique;
						if (
							this.plugin.settings.defaultAgentId === previousId
						) {
							this.plugin.settings.defaultAgentId = unique;
						}
						this.plugin.ensureDefaultAgentId();
						await this.flushSettings();
						this.refreshAgentDropdown();
					})();
				});

				// Autofocus the just-added agent's first field (set by
				// "Add custom agent") so the user can type immediately. Native
				// focus + select is keyboard-first; deferred to the next frame so
				// the (now-expanded) accordion body is laid out first.
				if (this.pendingFocusAgentId === agent.id) {
					this.pendingFocusAgentId = null;
					const inputEl = text.inputEl;
					window.requestAnimationFrame(() => {
						inputEl.focus();
						inputEl.select();
					});
				}
			});

		idSetting.addExtraButton((button) => {
			button
				.setIcon("trash")
				.setTooltip("Delete this agent")
				.onClick(async () => {
					this.plugin.settings.customAgents.splice(index, 1);
					this.plugin.ensureDefaultAgentId();
					await this.flushSettings();
					this.display();
				});
		});

		new Setting(blockEl)
			.setName("Display name")
			.setDesc("Shown in menus and headers.")
			.addText((text) => {
				text.setPlaceholder("Custom agent")
					.setValue(agent.displayName || agent.id)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.customAgents[index].displayName =
							trimmed.length > 0
								? trimmed
								: this.plugin.settings.customAgents[index].id;
						await this.flushSettings();
						this.refreshAgentDropdown();
					});
			});

		new Setting(blockEl)
			.setName("Path")
			.setDesc(
				"Command name or path to the custom agent. Use just the command name to let the login shell resolve it, or enter an absolute path.",
			)
			.addText((text) => {
				text.setPlaceholder("Command name or path")
					.setValue(agent.command)
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].command =
							value.trim();
						await this.flushSettings();
					});
			});

		new Setting(blockEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("--flag\n--another=value")
					.setValue(this.formatArgs(agent.args))
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].args =
							this.parseArgs(value);
						await this.flushSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(blockEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. (Stored as plain text)",
			)
			.addTextArea((text) => {
				text.setPlaceholder("TOKEN=...")
					.setValue(this.formatEnv(agent.env))
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].env =
							this.parseEnv(value);
						await this.flushSettings();
					});
				text.inputEl.rows = 3;
			});

		this.addAgentWorkingDirectoryRow(
			blockEl,
			() =>
				this.plugin.settings.customAgents[index]
					.defaultWorkingDirectory ?? "",
			async (value) => {
				this.plugin.settings.customAgents[
					index
				].defaultWorkingDirectory = value;
				await this.flushSettings();
			},
		);
	}

	/**
	 * Flush the current `plugin.settings` state through `settingsService.updateSettings()`
	 * so that React components subscribed via `useSettings` re-render.
	 *
	 * Use this after calling legacy helpers (e.g. `ensureDefaultAgentId`) that mutate
	 * `plugin.settings` directly. Passes the current values as the "update" to trigger
	 * the notification pipeline without re-merging.
	 */
	private async flushSettings(): Promise<void> {
		await this.plugin.settingsService.updateSettings({
			customAgents: this.plugin.settings.customAgents,
			defaultAgentId: this.plugin.settings.defaultAgentId,
		});
	}

	private generateCustomAgentDisplayName(): string {
		const base = "Custom agent";
		const existing = new Set<string>();
		existing.add(
			this.plugin.settings.claude.displayName ||
				this.plugin.settings.claude.id,
		);
		existing.add(
			this.plugin.settings.codex.displayName ||
				this.plugin.settings.codex.id,
		);
		existing.add(
			this.plugin.settings.gemini.displayName ||
				this.plugin.settings.gemini.id,
		);
		for (const item of this.plugin.settings.customAgents) {
			existing.add(item.displayName || item.id);
		}
		if (!existing.has(base)) {
			return base;
		}
		let counter = 2;
		let candidate = `${base} ${counter}`;
		while (existing.has(candidate)) {
			counter += 1;
			candidate = `${base} ${counter}`;
		}
		return candidate;
	}

	// Create a readable ID for new custom agents and avoid collisions
	private generateCustomAgentId(): string {
		const base = "custom-agent";
		const existing = new Set(
			this.plugin.settings.customAgents.map((item) => item.id),
		);
		if (!existing.has(base)) {
			return base;
		}
		let counter = 2;
		let candidate = `${base}-${counter}`;
		while (existing.has(candidate)) {
			counter += 1;
			candidate = `${base}-${counter}`;
		}
		return candidate;
	}

	/**
	 * Renders a copyable npm install command hint below a Path setting.
	 */
	private addInstallHint(containerEl: HTMLElement, npmPackage: string): void {
		const command = `npm install -g ${npmPackage}@latest`;
		const frag = createFragment();
		frag.appendText("Not installed? Run in terminal: ");
		frag.createEl("code", { text: command });
		new Setting(containerEl).setDesc(frag).addButton((btn) => {
			btn.setButtonText("Copy").onClick(() => {
				void navigator.clipboard.writeText(command).then(
					() => {
						btn.setButtonText("Copied!");
						window.setTimeout(() => {
							btn.setButtonText("Copy");
						}, 1500);
					},
					() => undefined,
				);
			});
		});
	}

	/**
	 * Shared helper: adds an "Auto-detect" button to a Path setting.
	 * Calls `resolveCommandPath(commandName)` and, on success, writes the
	 * resolved absolute path via `onResolved`, then re-renders the tab.
	 */
	private addAutoDetectButton(
		setting: import("obsidian").Setting,
		commandName: string,
		onResolved: (path: string) => Promise<void>,
	): void {
		setting.addButton((btn) => {
			const isWsl = Platform.isWin && this.plugin.settings.windowsWslMode;
			const lookupCmd = Platform.isWin && !isWsl ? "where" : "which";
			btn.setButtonText("Auto-detect")
				.setTooltip(
					`Run \`${lookupCmd} ${commandName}\` to find the path`,
				)
				.onClick(async () => {
					btn.setButtonText("Detecting…");
					btn.setDisabled(true);
					try {
						const found = isWsl
							? await resolveCommandPathInWsl(
									commandName,
									this.plugin.settings
										.windowsWslDistribution || undefined,
								)
							: await resolveCommandPath(commandName);
						if (found) {
							await onResolved(found);
							this.display();
						} else {
							btn.setButtonText("Not found");
							window.setTimeout(() => {
								btn.setButtonText("Auto-detect");
								btn.setDisabled(false);
							}, 2000);
						}
					} catch {
						btn.setButtonText("Error");
						window.setTimeout(() => {
							btn.setButtonText("Auto-detect");
							btn.setDisabled(false);
						}, 2000);
					}
				});
		});
	}

	/**
	 * "Import settings" control. Rendered in Top matter on a fresh/un-configured
	 * install and in Advanced once configured (D5). Single definition, two call
	 * sites — placement is decided by display() from hasCompletedSetup.
	 */
	private renderImportSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Import settings from another plugin")
			.setDesc(
				"Bring over agent definitions, defaults, and API keys from another agent plugin (e.g. Agent Client). Shows a preview before applying.",
			)
			.addButton((btn) =>
				btn.setButtonText("Import…").onClick(() => {
					this.plugin.openImportSettingsModal();
				}),
			);
	}

	/**
	 * Low-level collapsible section: a native <details>/<summary> disclosure
	 * with a visible title. Native <details> gives keyboard toggle (Enter /
	 * Space on the focused summary) + aria-expanded for free, so the section is
	 * keyboard-first without hand-rolled handlers. `options.open` sets the
	 * initial state (default collapsed); `options.onToggle` (optional) fires
	 * with the new open state on user toggle, for callers that persist
	 * expansion. Callers wanting a fixed default (Export / Advanced) pass no
	 * onToggle. Shares the agent-section CSS class family so styling matches.
	 */
	private renderCollapsibleSection(
		parentEl: HTMLElement,
		title: string,
		renderBody: (bodyEl: HTMLElement) => void,
		options?: { open?: boolean; onToggle?: (open: boolean) => void },
	): void {
		const details = parentEl.createEl("details", {
			cls: "agent-client-agent-section",
		});
		details.open = options?.open ?? false;
		const summary = details.createEl("summary", {
			cls: "agent-client-agent-section-summary",
		});
		summary.createSpan({
			cls: "agent-client-agent-section-name",
			text: title,
		});
		const onToggle = options?.onToggle;
		if (onToggle) {
			details.addEventListener("toggle", () => {
				onToggle(details.open);
			});
		}
		renderBody(details);
	}

	/**
	 * Wrap an agent's settings block in a collapsible <details>/<summary>
	 * disclosure. Open/closed is per-session UI state in `agentExpansion`
	 * (Collapsible Agent Sections spec). Delegates to renderCollapsibleSection
	 * so the accordion mechanism is shared with Export / Advanced.
	 */
	private renderCollapsibleAgentSection(
		parentEl: HTMLElement,
		agentId: string,
		displayName: string,
		renderBody: (bodyEl: HTMLElement) => void,
	): void {
		this.renderCollapsibleSection(parentEl, displayName, renderBody, {
			open: this.agentExpansion.expanded.has(agentId),
			onToggle: (open) => {
				this.agentExpansion = toggleAgentExpansion(
					this.agentExpansion,
					agentId,
					open,
				);
			},
		});
	}

	/**
	 * Add a per-agent "Working directory" row (text + Browse + resolved-path desc).
	 * Resolution shown: per-agent value → global default → vault root.
	 */
	private addAgentWorkingDirectoryRow(
		sectionEl: HTMLElement,
		read: () => string,
		write: (value: string) => Promise<void>,
	): void {
		const adapter = this.plugin.app.vault.adapter;
		const vaultRoot =
			adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
		const describe = (value: string): string => {
			const globalDefault = this.plugin.settings.defaultWorkingDirectory;
			const base =
				"Folder new chats with this agent start in. Leave blank to use the global default working directory, then the vault root.";
			const resolved = resolveAgentWorkingDirectory(
				value,
				globalDefault,
				vaultRoot,
			);
			if (!value.trim()) {
				const label =
					resolved.source === "global"
						? " (global default)"
						: " (vault root)";
				return `${base} Currently: ${resolved.dir}${label}.`;
			}
			if (resolved.source !== "agent") {
				return `${base} ⚠ "${value}" is not a valid absolute directory — falling back to ${resolved.dir}.`;
			}
			return `${base} Resolved: ${resolved.dir}.`;
		};
		const setting = new Setting(sectionEl)
			.setName("Working directory")
			.setDesc(describe(read()));
		setting.addText((text) =>
			text
				.setPlaceholder("Leave blank for the global default")
				.setValue(read())
				.onChange(async (value) => {
					await write(value.trim());
					setting.setDesc(describe(value));
				}),
		);
		setting.addButton((btn) =>
			btn
				.setButtonText("Browse…")
				.setTooltip("Choose a folder")
				.onClick(async () => {
					const picked = await pickFolder({
						title: "Select working directory",
						defaultPath:
							read() ||
							this.plugin.settings.defaultWorkingDirectory ||
							vaultRoot,
					});
					if (picked) {
						await write(picked);
						this.display();
					}
				}),
		);
	}

	private formatArgs(args: string[]): string {
		return args.join("\n");
	}

	private parseArgs(value: string): string[] {
		return value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private formatEnv(env: AgentEnvVar[]): string {
		return env
			.map((entry) => `${entry.key}=${entry.value ?? ""}`)
			.join("\n");
	}

	private parseEnv(value: string): AgentEnvVar[] {
		const envVars: AgentEnvVar[] = [];

		for (const line of value.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const delimiter = trimmed.indexOf("=");
			if (delimiter === -1) {
				continue;
			}
			const key = trimmed.slice(0, delimiter).trim();
			const envValue = trimmed.slice(delimiter + 1).trim();
			if (!key) {
				continue;
			}
			envVars.push({ key, value: envValue });
		}

		return normalizeEnvVars(envVars);
	}
}
