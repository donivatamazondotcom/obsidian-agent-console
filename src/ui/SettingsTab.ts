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
import {
	t,
	SUPPORTED_LOCALES,
	LOCALE_DISPLAY_NAMES,
	languageReloadNotice,
} from "../i18n";
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
import { parseAgentArgs, formatAgentArgs } from "../utils/args";
import {
	composeObsidianSystemPrompt,
	obsidianSystemPromptIsCustomized,
	DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
} from "../utils/obsidian-system-prompt";
import { ConfirmResetModal } from "./ConfirmResetModal";
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
	agentOptionsFromSettings,
	collectAgentIdsExcept,
	resolveUniqueAgentId,
} from "../services/session-helpers";
import { deriveImportPlacement } from "../utils/settings-layout";

export class AgentClientSettingTab extends PluginSettingTab {
	plugin: AgentClientPlugin;
	private agentSelector: DropdownComponent | null = null;
	private unsubscribe: (() => void) | null = null;
	private agentExpansion: AgentExpansionState = freshAgentExpansion();
	// Obsidian system prompt — accordion open state (content persists in settings).
	private hcbExpanded = false;
	/**
	 * Agent id whose first field should grab focus on the next render — set
	 * when "Add custom agent" creates an agent, consumed (cleared) when that
	 * agent's Agent ID field renders. Per-session UI intent, not persisted.
	 */
	private pendingFocusAgentId: string | null = null;
	/**
	 * When the user clicks "Edit full prompt…", the tab re-renders into full
	 * mode; this flag tells the full-prompt textarea's render to grab focus
	 * (and scroll itself into view) so the cursor lands in the editable box,
	 * not on the read-only "What gets sent" preview below it.
	 */
	private pendingFocusObsidianFullPrompt = false;

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
		docContainer.createSpan({ text: t("settings.docLink.prefix") });
		docContainer.createEl("a", {
			text: t("settings.docLink.linkText"),
			href: "https://donivatamazondotcom.github.io/obsidian-agent-console/",
			attr: { target: "_blank" },
		});
		docContainer.createSpan({ text: t("settings.docLink.suffix") });

		new Setting(containerEl).setName(t("settings.heading.agents")).setHeading();

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
			const base = t("settings.defaultWorkingDirectory.desc");
			const root = vaultRoot ? ` (${vaultRoot})` : "";
			if (!value.trim()) {
				return `${base} ${t("settings.defaultWorkingDirectory.statusVaultRoot", { root })}`;
			}
			const resolved = resolveDefaultWorkingDirectory(value, vaultRoot);
			if (resolved.fellBack) {
				return `${base} ${t("settings.defaultWorkingDirectory.statusInvalid", { value, root })}`;
			}
			return `${base} ${t("settings.defaultWorkingDirectory.statusResolved", { dir: resolved.dir })}`;
		};
		const cwdSetting = new Setting(containerEl)
			.setName(t("settings.defaultWorkingDirectory.name"))
			.setDesc(describeCwd(this.plugin.settings.defaultWorkingDirectory));
		cwdSetting.addText((text) =>
			text
				.setPlaceholder(t("settings.defaultWorkingDirectory.placeholder"))
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
				.setButtonText(t("settings.defaultWorkingDirectory.button"))
				.setTooltip(t("settings.defaultWorkingDirectory.tooltip"))
				.onClick(async () => {
					const picked = await pickFolder({
						title: t("settings.defaultWorkingDirectory.pickerTitle"),
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

		new Setting(containerEl).setName(t("settings.heading.builtInAgents")).setHeading();

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
		this.renderCollapsibleAgentSection(
			containerEl,
			this.plugin.settings.opencode.id,
			this.plugin.settings.opencode.displayName || "OpenCode",
			(el) => this.renderOpenCodeSettings(el),
		);

		new Setting(containerEl).setName(t("settings.heading.customAgents")).setHeading();

		this.renderCustomAgents(containerEl);

		new Setting(containerEl).setName(t("settings.heading.chatBehavior")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.activeNoteAsDefault.name"))
			.setDesc(t("settings.activeNoteAsDefault.desc"))
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
			.setName(t("settings.sessionTitle.name"))
			.setDesc(t("settings.sessionTitle.desc"))
			.addDropdown((dropdown) => {
				const titleStrategyLabels: Record<TitleStrategy, string> = {
					"agent-suggested": t(
						"settings.sessionTitle.optionAgentSuggested",
					),
					"prompt-derived": t(
						"settings.sessionTitle.optionPromptDerived",
					),
					"agent-timestamp": t(
						"settings.sessionTitle.optionAgentTimestamp",
					),
				};
				for (const { value } of TITLE_STRATEGY_OPTIONS) {
					dropdown.addOption(value, titleStrategyLabels[value]);
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
			.setName(t("settings.quickPromptsFolder.name"))
			.setDesc(t("settings.quickPromptsFolder.desc"))
			.addText((text) => {
				text.setPlaceholder(t("settings.quickPromptsFolder.placeholder"))
					.setValue(this.plugin.settings.quickPromptsFolder)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							quickPromptsFolder: value.trim(),
						});
						void this.plugin.quickPromptLibrary.rescan();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.sendMessageShortcut.name"))
			.setDesc(t("settings.sendMessageShortcut.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption(
						"enter",
						t("settings.sendMessageShortcut.optionEnter"),
					)
					.addOption(
						"cmd-enter",
						t("settings.sendMessageShortcut.optionCmdEnter"),
					)
					.setValue(this.plugin.settings.sendMessageShortcut)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							sendMessageShortcut: value as "enter" | "cmd-enter",
						});
					}),
			);

		// Obsidian system prompt — single-artifact model. All rows render via the
		// Setting API so labels/controls share native alignment; textareas + the
		// preview are made full-width by a stacking class on their .setting-item.
		const hcbVaultRoot = resolveVaultRoot();
		const hcb = (): typeof this.plugin.settings.obsidianSystemPrompt =>
			this.plugin.settings.obsidianSystemPrompt;
		const setHcb = async (
			patch: Partial<typeof this.plugin.settings.obsidianSystemPrompt>,
		): Promise<void> => {
			await this.plugin.settingsService.updateSettings({
				obsidianSystemPrompt: { ...this.plugin.settings.obsidianSystemPrompt, ...patch },
			});
		};
		const hcbComposed = (appendOverride?: string): string => {
			const cur = hcb();
			const base =
				composeObsidianSystemPrompt(
					{ blocks: cur.blocks, mode: "options" },
					{ cwd: hcbVaultRoot, vaultRoot: hcbVaultRoot },
				) ?? "";
			const add = (appendOverride ?? cur.appendText ?? "").trim();
			return add ? base + "\n\n" + add : base;
		};
		const hcbFullWidth = (el: HTMLElement): void => {
			el.closest(".setting-item")?.classList.add(
				"agent-client-hcb-fullwidth",
			);
		};
		this.renderCollapsibleSection(
			containerEl,
			t("settings.section.obsidianSystemPrompt"),
			(body) => {
				let previewTa: import("obsidian").TextAreaComponent | null = null;
				let appendTa: import("obsidian").TextAreaComponent | null = null;
				let fullTa: import("obsidian").TextAreaComponent | null = null;
				const liveText = (): string => {
					const cur = hcb();
					if ((cur.mode ?? "options") === "full") {
						return (fullTa?.inputEl?.value ?? cur.customText ?? "").trim();
					}
					return hcbComposed(appendTa?.inputEl?.value).trim();
				};
				const refreshPreview = (): void => {
					if (!previewTa) return;
					previewTa.setValue(
						liveText() ||
							t("settings.obsidianPrompt.previewEmpty"),
					);
				};
				new Setting(body).setDesc(t("settings.sendMessageShortcut.desc2"));

				if ((hcb().mode ?? "options") === "options") {
					const blockToggle = (
						name: string,
						desc: string,
						key: keyof typeof this.plugin.settings.obsidianSystemPrompt.blocks,
					): void => {
						new Setting(body)
							.setName(name)
							.setDesc(desc)
							.addToggle((toggle) =>
								toggle
									.setValue(hcb().blocks[key])
									.onChange(async (value) => {
										await setHcb({
											blocks: { ...hcb().blocks, [key]: value },
										});
										// Avoid a full re-render (which scrolls the
										// pane and jumps the view) — just refresh
										// the live preview. The vault-note hint's
										// visibility depends on the vaultCollaboration
										// block, so only that toggle re-renders.
										if (key === "vaultCollaboration") {
											this.display();
										} else {
											refreshPreview();
										}
									}),
							);
					};
					blockToggle(
						t("settings.obsidianPrompt.hostIdentity.name"),
						t("settings.obsidianPrompt.hostIdentity.desc"),
						"hostIdentity",
					);
					blockToggle(
						t("settings.obsidianPrompt.rendering.name"),
						t("settings.obsidianPrompt.rendering.desc"),
						"rendering",
					);
					blockToggle(
						t("settings.obsidianPrompt.workingDirectory.name"),
						t("settings.obsidianPrompt.workingDirectory.desc"),
						"workingDirectory",
					);
					blockToggle(
						t("settings.obsidianPrompt.vaultCollaboration.name"),
						t("settings.obsidianPrompt.vaultCollaboration.desc"),
						"vaultCollaboration",
					);
					blockToggle(
						t("settings.obsidianPrompt.interactiveButtons.name"),
						t("settings.obsidianPrompt.interactiveButtons.desc"),
						"interactiveButtons",
					);

					new Setting(body)
						.setName(t("settings.yourVaultContext.name"))
						.setDesc(t("settings.yourVaultContext.desc"))
						.addTextArea((ta) => {
							appendTa = ta;
							ta.setValue(hcb().appendText ?? "");
							ta.inputEl.rows = 4;
							hcbFullWidth(ta.inputEl);
							ta.onChange(async (value) => {
								await setHcb({ appendText: value });
								refreshPreview();
							});
						});

					new Setting(body)
						.setName(t("settings.editTheFullPrompt.name"))
						.setDesc(t("settings.editTheFullPrompt.desc"))
						.addButton((btn) =>
							btn.setButtonText(t("settings.editTheFullPrompt.button")).onClick(async () => {
								const seeded = hcbComposed(appendTa?.inputEl?.value);
								this.pendingFocusObsidianFullPrompt = true;
								await setHcb({ mode: "full", customText: seeded });
								this.display();
							}),
						);
				} else {
					new Setting(body)
						.setName(t("settings.fullPrompt.name"))
						.setDesc(t("settings.fullPrompt.desc"))
						.addTextArea((ta) => {
							fullTa = ta;
							ta.setValue(hcb().customText ?? "");
							ta.inputEl.rows = 10;
							hcbFullWidth(ta.inputEl);
							ta.onChange(async (value) => {
								await setHcb({ customText: value });
								refreshPreview();
							});
							// Just switched into full mode: focus the editable
							// box, put the cursor at the end, and scroll it into
							// view so the user doesn't land on the read-only
							// "What gets sent" preview below.
							if (this.pendingFocusObsidianFullPrompt) {
								this.pendingFocusObsidianFullPrompt = false;
								const inputEl = ta.inputEl;
								window.requestAnimationFrame(() => {
									inputEl.focus();
									const end = inputEl.value.length;
									inputEl.setSelectionRange(end, end);
									inputEl.scrollIntoView({ block: "center" });
								});
							}
						});
					new Setting(body)
						.setName(t("settings.backToOptions.name"))
						.setDesc(t("settings.backToOptions.desc"))
						.addButton((btn) =>
							btn.setButtonText(t("settings.backToOptions.button")).onClick(async () => {
								await setHcb({ mode: "options" });
								this.display();
							}),
						);
				}

				// "What gets sent" is ALWAYS present — the constant, honest
				// picture of the exact text the agent receives. In options mode
				// it tracks the toggles + vault context; in full mode it mirrors
				// the hand-edited prompt live (the full-prompt box's onChange
				// calls refreshPreview, and liveText() reads that box in full
				// mode). Rendering it after the mode-specific section keeps the
				// input-above-output reading order in both modes.
				new Setting(body)
					.setName(t("settings.whatGetsSent.name"))
					.setDesc(t("settings.whatGetsSent.desc"))
					.addTextArea((ta) => {
						previewTa = ta;
						ta.inputEl.rows = 8;
						ta.inputEl.readOnly = true;
						ta.inputEl.classList.add("agent-client-hcb-readonly");
						hcbFullWidth(ta.inputEl);
						refreshPreview();
					});
				if (
					(hcb().mode ?? "options") === "options" &&
					hcb().blocks.vaultCollaboration
				) {
					new Setting(body).setDesc(t("settings.whatGetsSent.desc2"));
				}

				new Setting(body)
					.setName(t("settings.resetToDefaults.name"))
					.setDesc(t("settings.resetToDefaults.desc"))
					.addButton((btn) =>
						btn.setButtonText(t("settings.resetToDefaults.button")).onClick(async () => {
							const doReset = async (): Promise<void> => {
								await setHcb(
									structuredClone(
										DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
									),
								);
								this.display();
							};
							// Confirm only when reset would discard customization
							// (a block toggled off, full-prompt mode, or typed
							// text). A pristine all-default state resets directly.
							if (obsidianSystemPromptIsCustomized(hcb())) {
								new ConfirmResetModal(this.plugin.app, () => {
									void doReset();
								}).open();
							} else {
								await doReset();
							}
						}),
					);
			},
			{
				open: this.hcbExpanded,
				onToggle: (open: boolean) => {
					this.hcbExpanded = open;
				},
			},
		);

				new Setting(containerEl)
			.setName(t("settings.heading.appearanceNotifications"))
			.setHeading();

		new Setting(containerEl)
			.setName(t("settings.language.name"))
			.setDesc(t("settings.language.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOption(
					"auto",
					t("settings.language.optionAuto"),
				);
				for (const locale of SUPPORTED_LOCALES) {
					dropdown.addOption(
						locale,
						LOCALE_DISPLAY_NAMES[locale],
					);
				}
				dropdown
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings(
							{
								language:
									value as typeof this.plugin.settings.language,
							},
						);
						new Notice(languageReloadNotice(value));
					});
			});

		new Setting(containerEl)
			.setName(t("settings.sidebarSide.name"))
			.setDesc(t("settings.sidebarSide.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("right", t("settings.sidebarSide.optionRight"))
					.addOption("left", t("settings.sidebarSide.optionLeft"))
					.setValue(this.plugin.settings.chatViewLocation)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							chatViewLocation: value as ChatViewLocation,
						});
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.chatFontSize.name"))
			.setDesc(
				t("settings.fontSize.desc", {
					min: CHAT_FONT_SIZE_MIN,
					max: CHAT_FONT_SIZE_MAX,
				}),
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
					const probe = activeDocument.body.createDiv({
						cls: [
							"agent-client-chat-view-container",
							"agent-client-font-size-probe",
						],
					});
					const messages = probe.createDiv({
						cls: "agent-client-chat-view-messages",
					});
					const computedFontSize =
						getComputedStyle(messages).fontSize;
					probe.remove();
					return parseComputedFontSizePx(computedFontSize);
				};

				const getPlaceholder = (): string => {
					const effectivePx = getEffectiveChatFontSizePx();
					return effectivePx === null
						? `${CHAT_FONT_SIZE_MIN}-${CHAT_FONT_SIZE_MAX}`
						: t("settings.chatFontSize.placeholderCurrent", {
								px: effectivePx,
							});
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
			.setName(t("settings.showEmojis.name"))
			.setDesc(t("settings.showEmojis.desc"))
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
			.setName(t("settings.systemNotifications.name"))
			.setDesc(t("settings.systemNotifications.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableSystemNotifications)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							enableSystemNotifications: value,
						});
					}),
			);

		new Setting(containerEl).setName(t("settings.heading.tabs")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.restoreTabsOnStartup.name"))
			.setDesc(t("settings.restoreTabsOnStartup.desc"))
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
			.setName(t("settings.confirmBeforeClosingMultiple.name"))
			.setDesc(t("settings.confirmBeforeClosingMultiple.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.confirmCloseWithMultipleTabs)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							confirmCloseWithMultipleTabs: value,
						});
					}),
			);

		new Setting(containerEl).setName(t("settings.heading.permissions")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.autoAllowPermissions.name"))
			.setDesc(t("settings.autoAllowPermissions.desc"))
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

		this.renderCollapsibleSection(
			containerEl,
			t("settings.section.export"),
			(containerEl) => {
			new Setting(containerEl)
				.setName(t("settings.exportFolder.name"))
				.setDesc(t("settings.exportFolder.desc"))
				.addText((text) =>
					text
						.setPlaceholder(t("settings.exportFolder.placeholder"))
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
				.setName(t("settings.filename.name"))
				.setDesc(t("settings.filename.desc"))
				.addText((text) =>
					text
						.setPlaceholder(t("settings.filename.placeholder"))
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
				.setName(t("settings.frontmatterTag.name"))
				.setDesc(t("settings.frontmatterTag.desc"))
				.addText((text) =>
					text
						.setPlaceholder(t("settings.frontmatterTag.placeholder"))
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
				.setName(t("settings.includeImages.name"))
				.setDesc(t("settings.includeImages.desc"))
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
					.setName(t("settings.imageLocation.name"))
					.setDesc(t("settings.imageLocation.desc"))
					.addDropdown((dropdown) =>
						dropdown
							.addOption(
								"obsidian",
								t("settings.imageLocation.optionObsidian"),
							)
							.addOption(
								"custom",
								t("settings.imageLocation.optionCustom"),
							)
							.addOption(
								"base64",
								t("settings.imageLocation.optionBase64"),
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
						.setName(t("settings.customImageFolder.name"))
						.setDesc(t("settings.customImageFolder.desc"))
						.addText((text) =>
							text
								.setPlaceholder(t("settings.customImageFolder.placeholder"))
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
				.setName(t("settings.autoExportOnNew.name"))
				.setDesc(t("settings.autoExportOnNew.desc"))
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
				.setName(t("settings.autoExportOnClose.name"))
				.setDesc(t("settings.autoExportOnClose.desc"))
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
				.setName(t("settings.openNoteAfterExport.name"))
				.setDesc(t("settings.openNoteAfterExport.desc"))
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
			t("settings.section.advanced"),
			(containerEl) => {
				const nodePathSetting = new Setting(containerEl)
					.setName(t("settings.nodeJsPath.name"))
					.setDesc(t("settings.nodeJsPath.desc"))
					.addText((text) => {
						text.setPlaceholder(t("settings.nodeJsPath.placeholder"))
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
						.setName(t("settings.heading.windowsSubsystemForLinux"))
						.setHeading();

					new Setting(containerEl)
						.setName(t("settings.enableWslMode.name"))
						.setDesc(t("settings.enableWslMode.desc"))
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
							.setName(t("settings.wslDistribution.name"))
							.setDesc(t("settings.wslDistribution.desc"))
							.addText((text) =>
								text
									.setPlaceholder(t("settings.wslDistribution.placeholder"))
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
					.setName(t("settings.debugMode.name"))
					.setDesc(t("settings.debugMode.desc"))
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
			.setName(t("settings.defaultAgent.name"))
			.setDesc(t("settings.defaultAgent.desc"))
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
		return agentOptionsFromSettings(this.plugin.settings);
	}

	private renderGeminiSettings(sectionEl: HTMLElement) {
		const gemini = this.plugin.settings.gemini;

		new Setting(sectionEl)
			.setName(t("settings.apiKey.name"))
			.setDesc(t("settings.apiKey.desc"))
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
			.setName(t("settings.path.name"))
			.setDesc(t("settings.path.desc"))
			.addText((text) => {
				text.setPlaceholder(t("settings.path.placeholder"))
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
			.setName(t("settings.arguments.name"))
			.setDesc(t("settings.arguments.desc"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.arguments.placeholder"))
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
			.setName(t("settings.environmentVariables.name"))
			.setDesc(t("settings.environmentVariables.desc"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.environmentVariables.placeholder"))
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
			.setName(t("settings.authentication.name"))
			.setDesc(t("settings.authentication.desc2"));

		const kiroPathSetting = new Setting(sectionEl)
			.setName(t("settings.path.name2"))
			.setDesc(t("settings.path.desc2"))
			.addText((text) => {
				text.setPlaceholder(t("settings.path.placeholder2"))
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
			.setName(t("settings.arguments.name2"))
			.setDesc(t("settings.arguments.desc2"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.arguments.placeholder2"))
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
			.setName(t("settings.environmentVariables.name2"))
			.setDesc(t("settings.authentication.desc"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.environmentVariables.placeholder2"))
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

	private renderOpenCodeSettings(sectionEl: HTMLElement) {
		const opencode = this.plugin.settings.opencode;

		new Setting(sectionEl)
			.setName(t("settings.setup.name"))
			.setDesc(t("settings.setup.desc8"));

		const opencodePathSetting = new Setting(sectionEl)
			.setName(t("settings.path.name3"))
			.setDesc(t("settings.path.desc3"))
			.addText((text) => {
				text.setPlaceholder(t("settings.path.placeholder3"))
					.setValue(opencode.command)
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							opencode: {
								...this.plugin.settings.opencode,
								command: value.trim(),
							},
						});
					});
			});
		this.addAutoDetectButton(opencodePathSetting, "opencode", async (path) => {
			await this.plugin.settingsService.updateSettings({
				opencode: {
					...this.plugin.settings.opencode,
					command: path,
				},
			});
		});

		new Setting(sectionEl)
			.setName(t("settings.arguments.name3"))
			.setDesc(t("settings.arguments.desc3"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.arguments.placeholder3"))
					.setValue(this.formatArgs(opencode.args))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							opencode: {
								...this.plugin.settings.opencode,
								args: this.parseArgs(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName(t("settings.environmentVariables.name3"))
			.setDesc(t("settings.setup.desc"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.environmentVariables.placeholder3"))
					.setValue(this.formatEnv(opencode.env))
					.onChange(async (value) => {
						await this.plugin.settingsService.updateSettings({
							opencode: {
								...this.plugin.settings.opencode,
								env: this.parseEnv(value),
							},
						});
					});
				text.inputEl.rows = 3;
			});

		this.addAgentWorkingDirectoryRow(
			sectionEl,
			() => this.plugin.settings.opencode.defaultWorkingDirectory ?? "",
			async (value) => {
				await this.plugin.settingsService.updateSettings({
					opencode: {
						...this.plugin.settings.opencode,
						defaultWorkingDirectory: value,
					},
				});
			},
		);
	}

	private renderClaudeSettings(sectionEl: HTMLElement) {
		const claude = this.plugin.settings.claude;

		new Setting(sectionEl)
			.setName(t("settings.apiKey.name2"))
			.setDesc(t("settings.setup.desc2"))
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
			.setName(t("settings.path.name4"))
			.setDesc(t("settings.path.desc4"))
			.addText((text) => {
				text.setPlaceholder(t("settings.path.placeholder4"))
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
			.setName(t("settings.arguments.name4"))
			.setDesc(t("settings.setup.desc3"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.arguments.placeholder4"))
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
			.setName(t("settings.environmentVariables.name4"))
			.setDesc(t("settings.setup.desc4"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.environmentVariables.placeholder4"))
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
			.setName(t("settings.apiKey.name3"))
			.setDesc(t("settings.setup.desc5"))
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
			.setName(t("settings.path.name5"))
			.setDesc(t("settings.path.desc5"))
			.addText((text) => {
				text.setPlaceholder(t("settings.path.placeholder5"))
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
			.setName(t("settings.arguments.name5"))
			.setDesc(t("settings.setup.desc6"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.arguments.placeholder5"))
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
			.setName(t("settings.environmentVariables.name5"))
			.setDesc(t("settings.setup.desc7"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.environmentVariables.placeholder5"))
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
				text: t("settings.customAgents.emptyState"),
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
				.setButtonText(t("settings.environmentVariables.button"))
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
			.setName(t("settings.agentId.name"))
			.setDesc(t("settings.agentId.desc"))
			.addText((text) => {
				text.setPlaceholder(t("settings.agentId.placeholder"))
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
								t("notices.agentIdInUse", {
									desired,
									unique,
								}),
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
				.setTooltip(t("settings.agentId.tooltip"))
				.onClick(async () => {
					this.plugin.settings.customAgents.splice(index, 1);
					this.plugin.ensureDefaultAgentId();
					await this.flushSettings();
					this.display();
				});
		});

		new Setting(blockEl)
			.setName(t("settings.displayName.name"))
			.setDesc(t("settings.displayName.desc"))
			.addText((text) => {
				text.setPlaceholder(t("settings.displayName.placeholder"))
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
			.setName(t("settings.path.name6"))
			.setDesc(t("settings.displayName.desc2"))
			.addText((text) => {
				text.setPlaceholder(t("settings.path.placeholder6"))
					.setValue(agent.command)
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].command =
							value.trim();
						await this.flushSettings();
					});
			});

		new Setting(blockEl)
			.setName(t("settings.arguments.name6"))
			.setDesc(t("settings.displayName.desc3"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.arguments.placeholder6"))
					.setValue(this.formatArgs(agent.args))
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].args =
							this.parseArgs(value);
						await this.flushSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(blockEl)
			.setName(t("settings.environmentVariables.name6"))
			.setDesc(t("settings.displayName.desc4"))
			.addTextArea((text) => {
				text.setPlaceholder(t("settings.environmentVariables.placeholder6"))
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
		const base = t("settings.customAgents.defaultName");
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
		frag.appendText(t("settings.installHint.prefix"));
		frag.createEl("code", { text: command });
		new Setting(containerEl).setDesc(frag).addButton((btn) => {
			btn.setButtonText(t("settings.environmentVariables.button2")).onClick(() => {
				void navigator.clipboard.writeText(command).then(
					() => {
						btn.setButtonText(t("settings.environmentVariables.button3"));
						window.setTimeout(() => {
							btn.setButtonText(t("settings.environmentVariables.button4"));
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
			btn.setButtonText(t("settings.environmentVariables.button5"))
				.setTooltip(
					t("settings.autoDetect.tooltip", {
						lookupCmd,
						commandName,
					}),
				)
				.onClick(async () => {
					btn.setButtonText(t("settings.environmentVariables.button6"));
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
							btn.setButtonText(t("settings.environmentVariables.button7"));
							window.setTimeout(() => {
								btn.setButtonText(t("settings.environmentVariables.button8"));
								btn.setDisabled(false);
							}, 2000);
						}
					} catch {
						btn.setButtonText(t("settings.environmentVariables.button9"));
						window.setTimeout(() => {
							btn.setButtonText(t("settings.environmentVariables.button10"));
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
			.setName(t("settings.importSettingsFromAnother.name"))
			.setDesc(t("settings.importSettingsFromAnother.desc"))
			.addButton((btn) =>
				btn.setButtonText(t("settings.importSettingsFromAnother.button")).onClick(() => {
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
		options?: {
			open?: boolean;
			onToggle?: (open: boolean) => void;
			/** When set, stamps `data-agent-id` on the <details> for stable targeting (tests, screenshots). */
			agentId?: string;
		},
	): void {
		const details = parentEl.createEl("details", {
			cls: "agent-client-agent-section",
		});
		details.open = options?.open ?? false;
		if (options?.agentId) {
			details.dataset.agentId = options.agentId;
		}
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
			agentId,
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
			const base = t("settings.agentWorkingDirectory.desc");
			const resolved = resolveAgentWorkingDirectory(
				value,
				globalDefault,
				vaultRoot,
			);
			if (!value.trim()) {
				const label =
					resolved.source === "global"
						? t("settings.agentWorkingDirectory.sourceGlobal")
						: t("settings.agentWorkingDirectory.sourceVaultRoot");
				return `${base} ${t("settings.agentWorkingDirectory.statusCurrent", { dir: resolved.dir, label })}`;
			}
			if (resolved.source !== "agent") {
				return `${base} ${t("settings.agentWorkingDirectory.statusInvalid", { value, dir: resolved.dir })}`;
			}
			return `${base} ${t("settings.agentWorkingDirectory.statusResolved", { dir: resolved.dir })}`;
		};
		const setting = new Setting(sectionEl)
			.setName(t("settings.workingDirectory.name"))
			.setDesc(describe(read()));
		setting.addText((text) =>
			text
				.setPlaceholder(t("settings.workingDirectory.placeholder"))
				.setValue(read())
				.onChange(async (value) => {
					await write(value.trim());
					setting.setDesc(describe(value));
				}),
		);
		setting.addButton((btn) =>
			btn
				.setButtonText(t("settings.workingDirectory.button"))
				.setTooltip(t("settings.workingDirectory.tooltip"))
				.onClick(async () => {
					const picked = await pickFolder({
						title: t("settings.workingDirectory.pickerTitle"),
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
		return formatAgentArgs(args);
	}

	private parseArgs(value: string): string[] {
		return parseAgentArgs(value);
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
