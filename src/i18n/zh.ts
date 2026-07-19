/**
 * Simplified Chinese (中文) string catalog — settings, notices, and modals (phases 1–3).
 *
 * Factory-wrapped: instantiated only when Chinese is the active locale.
 * Partial against the English contract; missing keys fall back to English.
 * Keys holding literal values (example commands, folder names, KEY=VALUE
 * samples) are intentionally omitted — the English/literal value is
 * correct for every locale.
 *
 * Machine-translated; no native-speaker review yet. Corrections welcome —
 * see CONTRIBUTING.md for the translation-fix PR path.
 */
import type { en } from "./en";

export const zh = (): Partial<Record<keyof typeof en, string>> => ({
	"settings.heading.agents": "代理",
	"settings.defaultWorkingDirectory.name": "默认工作目录",
	"settings.defaultWorkingDirectory.placeholder": "留空则使用仓库根目录",
	"settings.defaultWorkingDirectory.button": "浏览…",
	"settings.defaultWorkingDirectory.tooltip": "选择文件夹",
	"settings.heading.builtInAgents": "内置代理",
	"settings.heading.customAgents": "自定义代理",
	"settings.heading.chatBehavior": "聊天行为",
	"settings.activeNoteAsDefault.name": "将当前笔记设为默认上下文",
	"settings.sessionTitle.name": "会话标题",
	"settings.quickPromptsFolder.name": "快速提示词文件夹",
	"settings.sendMessageShortcut.name": "发送消息快捷键",
	"settings.yourVaultContext.name": "我的仓库上下文",
	"settings.editTheFullPrompt.name": "编辑完整提示词",
	"settings.editTheFullPrompt.button": "编辑完整提示词…",
	"settings.fullPrompt.name": "完整提示词",
	"settings.backToOptions.name": "返回选项",
	"settings.backToOptions.button": "返回选项",
	"settings.whatGetsSent.name": "发送的内容",
	"settings.resetToDefaults.name": "重置为默认值",
	"settings.resetToDefaults.button": "重置为默认值",
	"settings.heading.appearanceNotifications": "外观与通知",
	"settings.sidebarSide.name": "侧边栏位置",
	"settings.sidebarSide.desc": "选择新聊天视图在哪个侧边栏打开",
	"settings.chatFontSize.name": "聊天字体大小",
	"settings.showEmojis.name": "显示表情符号",
	"settings.systemNotifications.name": "系统通知",
	"settings.heading.tabs": "标签页",
	"settings.restoreTabsOnStartup.name": "启动时恢复标签页",
	"settings.confirmBeforeClosingMultiple.name": "关闭多个聊天前确认",
	"settings.heading.permissions": "权限",
	"settings.autoAllowPermissions.name": "自动允许权限",
	"settings.exportFolder.name": "导出文件夹",
	"settings.exportFolder.desc": "聊天导出文件的保存文件夹",
	"settings.filename.name": "文件名",
	"settings.frontmatterTag.name": "Frontmatter 标签",
	"settings.includeImages.name": "包含图片",
	"settings.includeImages.desc": "在导出的 Markdown 文件中包含图片",
	"settings.imageLocation.name": "图片保存位置",
	"settings.imageLocation.desc": "导出图片的保存位置",
	"settings.customImageFolder.name": "自定义图片文件夹",
	"settings.autoExportOnNew.name": "新建聊天时自动导出",
	"settings.autoExportOnClose.name": "关闭聊天时自动导出",
	"settings.openNoteAfterExport.name": "导出后打开笔记",
	"settings.openNoteAfterExport.desc": "导出完成后自动打开导出的笔记",
	"settings.nodeJsPath.name": "Node.js 路径",
	"settings.heading.windowsSubsystemForLinux":
		"Windows Subsystem for Linux",
	"settings.enableWslMode.name": "启用 WSL 模式",
	"settings.wslDistribution.name": "WSL 发行版",
	"settings.wslDistribution.placeholder": "留空则使用默认发行版",
	"settings.debugMode.name": "调试模式",
	"settings.defaultAgent.name": "默认代理",
	"settings.defaultAgent.desc": "选择打开新聊天视图时使用的代理。",
	"settings.apiKey.name": "API 密钥",
	"settings.path.name": "路径",
	"settings.arguments.name": "参数",
	"settings.environmentVariables.name": "环境变量",
	"settings.authentication.name": "身份验证",
	"settings.path.name2": "路径",
	"settings.arguments.name2": "参数",
	"settings.environmentVariables.name2": "环境变量",
	"settings.setup.name": "设置",
	"settings.path.name3": "路径",
	"settings.arguments.name3": "参数",
	"settings.environmentVariables.name3": "环境变量",
	"settings.apiKey.name2": "API 密钥",
	"settings.path.name4": "路径",
	"settings.arguments.name4": "参数",
	"settings.environmentVariables.name4": "环境变量",
	"settings.apiKey.name3": "API 密钥",
	"settings.path.name5": "路径",
	"settings.arguments.name5": "参数",
	"settings.environmentVariables.name5": "环境变量",
	"settings.environmentVariables.button": "添加自定义代理",
	"settings.agentId.name": "代理 ID",
	"settings.agentId.desc": "用于引用此代理的唯一标识符。",
	"settings.agentId.tooltip": "删除此代理",
	"settings.displayName.name": "显示名称",
	"settings.displayName.desc": "显示在菜单和标题栏中。",
	"settings.path.name6": "路径",
	"settings.path.placeholder6": "命令名称或路径",
	"settings.arguments.name6": "参数",
	"settings.environmentVariables.name6": "环境变量",
	"settings.environmentVariables.button2": "复制",
	"settings.environmentVariables.button3": "已复制！",
	"settings.environmentVariables.button4": "复制",
	"settings.environmentVariables.button5": "自动检测",
	"settings.environmentVariables.button6": "检测中…",
	"settings.environmentVariables.button7": "未找到",
	"settings.environmentVariables.button8": "自动检测",
	"settings.environmentVariables.button9": "出错",
	"settings.environmentVariables.button10": "自动检测",
	"settings.importSettingsFromAnother.name": "从其他插件导入设置",
	"settings.importSettingsFromAnother.button": "导入…",
	"settings.workingDirectory.name": "工作目录",
	"settings.workingDirectory.placeholder": "留空则使用全局默认值",
	"settings.workingDirectory.button": "浏览…",
	"settings.workingDirectory.tooltip": "选择文件夹",
	"settings.activeNoteAsDefault.desc":
		"自动将当前打开的笔记添加到新聊天的上下文栏。你也可以随时用抓取按钮手动固定笔记。",
	"settings.sessionTitle.desc":
		"新聊天标签页名称的生成方式。“代理建议”会在代理首次回复时请求一个简短标题，标题到达前先用你的第一条消息代替。你随时可以手动重命名标签页。",
	"settings.quickPromptsFolder.desc":
		"扫描快速提示词的仓库文件夹——每个提示词一个 Markdown 笔记。笔记的描述（或名称/标题/文件名）作为标签，正文作为提示词内容。更改会实时生效。",
	"settings.sendMessageShortcut.desc":
		"选择发送消息的键盘快捷键。注意：如果使用 Cmd/Ctrl+Enter，你可能需要先解除已分配给 Cmd/Ctrl+Enter 的其他快捷键（设置 → 快捷键）。",
	"settings.sendMessageShortcut.desc2":
		"随每个聊天的第一条消息发送给代理，帮助它在 Obsidian 中自然工作。大多数情况下保持默认即可。",
	"settings.yourVaultContext.desc":
		"你写给代理的说明——文件存放位置、命名和链接习惯、你偏好的语气。会附加到提示词末尾，对此仓库的每个聊天都相同。",
	"settings.editTheFullPrompt.desc":
		"高级：完全手动接管整个提示词。打开时会预填下方显示的文本。",
	"settings.fullPrompt.desc":
		"你正在手动编辑整个提示词。开关设置已合并进这段文本，不再单独生效；下方预览即为实际发送的内容。",
	"settings.backToOptions.desc":
		"返回开关设置。你手动编辑的文本会保留，以备再次使用。",
	"settings.whatGetsSent.desc":
		"只读预览：代理在第一条消息中收到的确切文本。",
	"settings.whatGetsSent.desc2":
		"仅当聊天的文件夹位于仓库内时才会发送笔记相关内容。",
	"settings.resetToDefaults.desc":
		"打开所有开关，清除仓库上下文和手动编辑的提示词，并返回选项视图。",
	"settings.showEmojis.desc":
		"在工具调用、思考过程、计划和终端块中显示表情图标。",
	"settings.systemNotifications.desc":
		"当代理完成回复或请求权限时显示通知。完成通知会标注标签页名称，点击可切换到该标签页。Obsidian 处于前台时不会打扰。",
	"settings.restoreTabsOnStartup.desc":
		"退出 Obsidian 时保存打开的标签页，下次启动时恢复。每个视图独立恢复自己的标签页。",
	"settings.confirmBeforeClosingMultiple.desc":
		"当面板中有 2 个以上聊天时，使用 Cmd+W 关闭前先警告，避免一次丢失多个正在运行的代理。",
	"settings.autoAllowPermissions.desc":
		"自动允许代理的所有权限请求。⚠️ 请谨慎使用——这会让代理获得对你系统的完全访问权限。",
	"settings.filename.desc":
		"导出文件名模板。用 {date} 表示日期，{time} 表示时间",
	"settings.frontmatterTag.desc":
		"添加到导出笔记的标签。支持嵌套标签（例如 projects/agent-console）。留空则禁用。",
	"settings.customImageFolder.desc":
		"导出图片的文件夹路径（相对于仓库根目录）",
	"settings.autoExportOnNew.desc": "开始新聊天时自动导出当前聊天",
	"settings.autoExportOnClose.desc": "关闭聊天视图时自动导出当前聊天",
	"settings.nodeJsPath.desc":
		"Node.js 的路径。通常留空。仅当 node 位于非标准位置时才需要（输入绝对路径，例如 /usr/local/bin/node）。",
	"settings.nodeJsPath.placeholder": "留空（登录 shell 会自动解析）",
	"settings.enableWslMode.desc":
		"在 Windows Subsystem for Linux 中运行代理。推荐用于 Codex 等在原生 Windows 环境下运行不佳的代理。",
	"settings.wslDistribution.desc":
		"指定 WSL 发行版名称（留空使用默认值）。例如：Ubuntu、Debian",
	"settings.debugMode.desc":
		"在控制台输出调试日志。对开发和排查问题很有用。",
	"settings.apiKey.desc":
		"Gemini API 密钥。不使用 Google 账户登录时需要。从 Obsidian 的密钥链中选择或新建一个密钥。",
	"settings.environmentVariables.desc":
		"输入 KEY=VALUE 键值对，每行一个。Vertex AI 身份验证需要此项。GEMINI_API_KEY 会从上方字段自动获取。",
	"settings.authentication.desc":
		"输入 KEY=VALUE 键值对，每行一个。除非你的环境需要，否则请留空。",
	"settings.setup.desc":
		"输入 KEY=VALUE 键值对，每行一个。仅作用于 OpenCode 进程，不作用于模型后端。例如，本地模型的上下文长度应在 ollama 服务器上设置（OLLAMA_CONTEXT_LENGTH），而不是这里。除非你的环境需要，否则请留空。",
	"settings.setup.desc2":
		"Anthropic API 密钥。不使用 Anthropic 账户登录时需要。从 Obsidian 的密钥链中选择或新建一个密钥。",
	"settings.setup.desc3":
		"输入参数，用空格或换行分隔。含空格的参数请加引号。留空则不带参数运行。",
	"settings.setup.desc4":
		"输入 KEY=VALUE 键值对，每行一个。ANTHROPIC_API_KEY 会从上方字段自动获取。",
	"settings.setup.desc5":
		"OpenAI API 密钥。不使用 OpenAI 账户登录时需要。从 Obsidian 的密钥链中选择或新建一个密钥。",
	"settings.setup.desc6":
		"输入参数，用空格或换行分隔。含空格的参数请加引号。留空则不带参数运行。",
	"settings.setup.desc7":
		"输入 KEY=VALUE 键值对，每行一个。OPENAI_API_KEY 会从上方字段自动获取。",
	"settings.displayName.desc2":
		"自定义代理的命令名称或路径。只填命令名称可由登录 shell 解析，也可以输入绝对路径。",
	"settings.displayName.desc3":
		"输入参数，用空格或换行分隔。含空格的参数请加引号。留空则不带参数运行。",
	"settings.displayName.desc4":
		"输入 KEY=VALUE 键值对，每行一个。（以纯文本存储）",
	"settings.importSettingsFromAnother.desc":
		"从其他代理插件（例如 Agent Client）导入代理定义、默认设置和 API 密钥。应用前会显示预览。",
	"settings.path.desc":
		'Gemini CLI 的命令名称或路径。只填 "gemini" 可由登录 shell 解析；如需指定版本，请输入绝对路径。',
	"settings.arguments.desc":
		'输入参数，用空格或换行分隔。含空格的参数请加引号。留空则不带参数运行。（目前 Gemini CLI 需要 "--experimental-acp" 选项。）',
	"settings.authentication.desc2":
		'Kiro CLI 使用你的 Kiro 账户登录，无需 API 密钥。在终端中运行一次 "kiro-cli" 完成登录，然后在这里选择 Kiro CLI。',
	"settings.path.desc2":
		'kiro-cli 的命令名称或路径。只填 "kiro-cli" 可由登录 shell 解析，也可以输入绝对路径（通常为 ~/.local/bin/kiro-cli）。',
	"settings.arguments.desc2":
		'输入参数，用空格或换行分隔。含空格的参数请加引号。Kiro CLI 需要 "acp" 子命令。',
	"settings.setup.desc8":
		"OpenCode 通过自身配置管理模型和登录，这里无需 API 密钥。使用 opencode.ai 的一行安装命令安装后选择 OpenCode。若要离线运行本地模型，请在 OpenCode 自己的配置中指向 ollama——参见 OpenCode 设置指南。",
	"settings.path.desc3":
		'opencode 的命令名称或路径。只填 "opencode" 可由登录 shell 解析，也可以输入绝对路径（通常为 ~/.opencode/bin/opencode）。',
	"settings.arguments.desc3":
		'输入参数，用空格或换行分隔。含空格的参数请加引号。OpenCode 需要 "acp" 子命令。',
	"settings.path.desc4":
		'claude-agent-acp 的命令名称或路径。只填 "claude-agent-acp" 可由登录 shell 解析，也可以输入绝对路径。',
	"settings.path.desc5":
		'codex-acp 的命令名称或路径。只填 "codex-acp" 可由登录 shell 解析，也可以输入绝对路径。',
	"settings.fontSize.desc": "调整聊天消息区域的字体大小（{min}-{max}px）。",
	"settings.autoDetect.tooltip":
		"运行 `{lookupCmd} {commandName}` 查找路径",
	"notices.agentIdInUse":
		'代理 ID "{desired}" 已被使用——已改为 "{unique}"。',
	"settings.docLink.prefix": "需要帮助？请查看",
	"settings.docLink.linkText": "文档",
	"settings.docLink.suffix": "。",
	"settings.customAgents.emptyState": "尚未配置自定义代理。",
	"settings.language.name": "语言",
	"settings.language.desc":
		"此插件的按钮、菜单和消息使用的语言。“自动”跟随 Obsidian 的语言设置。",
	"settings.language.optionAuto": "自动（与 Obsidian 一致）",
	"settings.language.reloadNotice": "语言将在 Obsidian 重新加载后生效。",
	"settings.section.obsidianSystemPrompt": "Obsidian 系统提示词",
	"settings.section.export": "导出",
	"settings.section.advanced": "高级",
	"settings.sidebarSide.optionRight": "右侧边栏",
	"settings.sidebarSide.optionLeft": "左侧边栏",
	"settings.sendMessageShortcut.optionEnter":
		"Enter 发送，Shift+Enter 换行",
	"settings.sendMessageShortcut.optionCmdEnter":
		"Cmd/Ctrl+Enter 发送，Enter 换行",
	"settings.imageLocation.optionObsidian": "使用 Obsidian 的附件设置",
	"settings.imageLocation.optionCustom": "保存到自定义文件夹",
	"settings.imageLocation.optionBase64": "以 Base64 嵌入（不推荐）",
	"settings.sessionTitle.optionAgentSuggested": "由代理在首次回复中建议",
	"settings.sessionTitle.optionPromptDerived": "根据我的第一条消息生成",
	"settings.sessionTitle.optionAgentTimestamp": "代理名称和时间戳",
	"settings.obsidianPrompt.hostIdentity.name": "告知它运行在 Obsidian 中",
	"settings.obsidianPrompt.hostIdentity.desc":
		"让代理知道它正在你的 Obsidian 应用内工作。",
	"settings.obsidianPrompt.rendering.name": "说明回复的显示方式",
	"settings.obsidianPrompt.rendering.desc":
		"告诉代理如何排版回复，使链接、公式和图表正确显示，以及写笔记时应遵循哪些 Obsidian 约定。",
	"settings.obsidianPrompt.workingDirectory.name": "共享工作文件夹",
	"settings.obsidianPrompt.workingDirectory.desc":
		"告诉代理此聊天在哪个文件夹中工作。",
	"settings.obsidianPrompt.vaultCollaboration.name": "允许它处理我的笔记",
	"settings.obsidianPrompt.vaultCollaboration.desc":
		"告诉代理它可以读取和编辑你的笔记。仅当聊天在仓库内运行时发送。",
	"settings.obsidianPrompt.interactiveButtons.name": "提供可点击的选项",
	"settings.obsidianPrompt.interactiveButtons.desc":
		"当代理给出少量选项时，允许它在回复中显示按钮。点击按钮会将你的选择作为普通消息发送。",
	"settings.obsidianPrompt.previewEmpty":
		"（不会发送系统提示词——代理不会获得任何 Obsidian 上下文。）",
	"settings.defaultWorkingDirectory.desc":
		"新聊天的起始目录。留空则使用仓库根目录。现有聊天和恢复的聊天保留各自的目录。",
	"settings.defaultWorkingDirectory.statusVaultRoot":
		"当前：仓库根目录{root}。",
	"settings.defaultWorkingDirectory.statusInvalid":
		'⚠ "{value}" 不是有效的绝对目录——新聊天将使用仓库根目录{root}。',
	"settings.defaultWorkingDirectory.statusResolved": "解析结果：{dir}。",
	"settings.chatFontSize.placeholderCurrent": "{px}（当前值）",
	"settings.installHint.prefix": "尚未安装？请在终端中运行：",
	"settings.agentWorkingDirectory.desc":
		"此代理的新聊天起始文件夹。留空则先使用全局默认工作目录，再退回仓库根目录。",
	"settings.agentWorkingDirectory.sourceGlobal": "（全局默认值）",
	"settings.agentWorkingDirectory.sourceVaultRoot": "（仓库根目录）",
	"settings.agentWorkingDirectory.statusCurrent": "当前：{dir}{label}。",
	"settings.agentWorkingDirectory.statusInvalid":
		'⚠ "{value}" 不是有效的绝对目录——将退回到 {dir}。',
	"settings.agentWorkingDirectory.statusResolved": "解析结果：{dir}。",
	"settings.defaultWorkingDirectory.pickerTitle": "选择默认工作目录",
	"settings.workingDirectory.pickerTitle": "选择工作目录",
	"settings.customAgents.defaultName": "自定义代理",
	// --- Phase 2: notices ---
	"notices.quickPromptCollided":
		"[Agent Console] 已存在同名的快速提示 — 已保存为“{basename}”。",
	"notices.quickPromptCreated": "[Agent Console] 已创建快速提示“{basename}”。",
	"notices.quickPromptCreateFailed":
		"[Agent Console] 无法创建快速提示 — 请查看控制台。",
	"notices.quickPromptNoteNotFound":
		"[Agent Console] 无法打开“{label}” — 未找到该笔记。",
	"notices.promptTextCopied": "[Agent Console] 已复制提示文本。",
	"notices.promptTextCopyFailed":
		"[Agent Console] 无法复制提示文本 — 请查看控制台。",
	"notices.quickPromptRenameFailed":
		"[Agent Console] 无法重命名快速提示 — 请查看控制台。",
	"notices.noQuickPromptsFound":
		"[Agent Console] 未找到快速提示。请在“{folder}”文件夹中添加 Markdown 笔记。",
	"notices.noChatTabsOpen": "[Agent Console] 没有打开的聊天标签页",
	"notices.noPromptToBroadcast": "[Agent Console] 没有可广播的提示",
	"notices.noOtherTabsToBroadcast":
		"[Agent Console] 没有其他可广播的聊天标签页",
	"notices.broadcastSkipNote": "（跳过 {count} 个 — 有待发送的排队消息）",
	"notices.promptBroadcast":
		"[Agent Console] 已向 {count} 个标签页广播提示{skipNote}",
	"notices.noTabsReadyToSend": "[Agent Console] 没有可发送的标签页",
	"notices.sentInTabs": "[Agent Console] 已在 {count} 个标签页中发送{skipNote}",
	"notices.cancelBroadcast": "[Agent Console] 已向 {count} 个标签页广播取消",
	"notices.contextStripMigration":
		"Agent Console：活动笔记不再跟随聊天。请使用新的上下文栏将笔记固定到上下文中。",
	"notices.importSettingsFound":
		"Agent Console：找到 {plugin} 的设置 — 点击导入。",
	"notices.apiKeyMigrated":
		"[Agent Console] 你的 {agent} API 密钥已迁移到 Obsidian 钥匙串，名称为“{secretId}”。",
	"notices.apiKeyMigratedFallback":
		"[Agent Console] “{defaultId}”已被占用。你的 {agent} API 密钥已迁移为“{fallbackId}”。可在 Obsidian 钥匙串设置中重命名。",
	"notices.updateAvailable": "[Agent Console] 有可用更新：v{version}",
	"notices.chatExported": "[Agent Console] 聊天已导出到 {path}",
	"notices.chatExportFailed": "[Agent Console] 导出聊天失败",
	"notices.alreadyNewSession": "[Agent Console] 已经是新会话",
	"notices.newSessionFailed": "[Agent Console] 创建新会话失败",
	"notices.noMessagesToExport": "[Agent Console] 没有可导出的消息",
	"notices.sessionRestartedFresh": "[Agent Console] 会话已重新开始（全新）",
	"notices.sessionReloading": "[Agent Console] 正在重新加载会话…",
	"notices.sessionReloaded": "[Agent Console] 会话已重新加载",
	"notices.sessionReloadedFresh":
		"[Agent Console] 此代理不支持恢复 — 已作为新会话重新加载（显示的历史为本地记录）",
	"notices.sessionReloadFailed": "[Agent Console] 重新加载会话失败",
	"notices.invalidWorkingDirectory":
		"Agent Console：配置的工作目录不是有效的绝对路径。新聊天已在 {dir} 中开始。",
	"notices.newChatStartedIn": "Agent Console：新聊天已在 {dir} 中开始",
	"notices.contextNoteDeleted":
		"[Agent Console] 上下文笔记“{name}”已被删除，并已从聊天上下文中移除。",
	"notices.noActivePermissionRequest": "[Agent Console] 没有待处理的权限请求",
	"notices.maxAttachments": "[Agent Console] 最多允许 {count} 个附件",
	"notices.imageTooLarge": "[Agent Console] 图片过大（最大 {size}MB）",
	"notices.imageAttachFailed": "[Agent Console] 附加图片失败",
	"notices.filePathUndetermined": "[Agent Console] 无法确定文件路径",
	"notices.imagePasteConnecting":
		"[Agent Console] 仍在连接代理 – 请稍后再粘贴图片。",
	"notices.imagePasteUnsupported":
		"[Agent Console] 此代理不支持粘贴图片。请尝试拖放。",
	"notices.tabRestoreCorrupted": "无法恢复之前的标签页 — 保存的状态已损坏。",
	"notices.viewDetails": "查看详情",
	"notices.noRecentlyClosedSession": "没有可重新打开的最近关闭的会话",
	"notices.duplicateTabName": "[Agent Console] 已存在同名标签页",
	"notices.sessionRestoreFailed": "[Agent Console] 恢复会话失败",
	"notices.sessionForkFailed": "[Agent Console] 分叉会话失败",
	"notices.sessionDeleted": "[Agent Console] 会话已删除",
	"notices.sessionDeleteFailed": "[Agent Console] 删除会话失败",
	"notices.titleUpdated": "[Agent Console] 标题已更新",
	"notices.titleUpdateFailed": "[Agent Console] 更新标题失败",
	"notices.titleEmpty": "标题不能为空",
	"notices.settingsImported":
		"Agent Console：已从 {source} 导入设置。{relinkMsg}",
	"notices.settingsImportedRelink": " 请在设置中重新关联 {count} 个 API 密钥。",
	"notices.settingsImportFailed": "Agent Console：导入失败。{error}",
	"notices.mcpSignInLinkCopied": "已复制“{server}”的登录链接",
	"notices.mcpNeedsSignInTitle": "MCP 服务器“{server}”需要登录",
	"notices.mcpOpensHost": "将打开 {host}",
	"notices.mcpSignIn": "登录",
	"notices.mcpCopyLink": "复制链接",
	"notices.mcpMoreWaiting": "此后还有 {count} 个等待：{names}",
	"notices.noActiveNoteToGrab": "[Agent Console] 没有可抓取的活动笔记",
	"notices.removedFromContext": "[Agent Console] 已将“{name}”从上下文中移除",
	"notices.contextFull":
		"[Agent Console] 上下文已满（{max} 条笔记）— 请先移除一条再添加",
	"notices.addedToContext": "[Agent Console] 已将“{name}”添加到上下文",
	"notices.viewRegistrationConflict":
		"另一个插件正在使用相同的视图，Agent Console 无法打开面板。请禁用两个插件中的一个并重新加载 Obsidian。",
	"notices.partialLoad":
		"Agent Console 已加载，但以下部分不可用：{parts}。请尝试重新加载 Obsidian；如果持续发生，可能是其他插件冲突。",
	"notices.cantSendNow": "现在无法发送 — 请等代理空闲时再试。",
	"notices.unknownError": "未知错误",
	// --- Phase 2: modals ---
	"modals.common.cancel": "取消",
	"modals.common.close": "关闭",
	"modals.renamePrompt.title": "重命名快速提示",
	"modals.renamePrompt.confirm": "重命名",
	"modals.agentPicker.placeholder": "为新聊天选择一个代理",
	"modals.confirmClose.title": "关闭 Agent Console？",
	"modals.confirmClose.body":
		"你有 {count} 个打开的聊天。关闭此面板将全部关闭。",
	"modals.confirmClose.hint": "关闭的聊天可以从会话历史中重新打开。",
	"modals.confirmClose.confirm": "关闭面板",
	"modals.quickPromptFolder.title": "快速提示应保存在哪里？",
	"modals.quickPromptFolder.body":
		"为你的快速提示笔记选择一个文件夹。它们会保存在这里，方便以后查找和编辑 — 你随时可以在设置中更改。",
	"modals.quickPromptFolder.confirm": "使用此文件夹",
	"modals.importSettings.title": "导入设置",
	"modals.importSettings.searching": "正在查找可导入的设置…",
	"modals.importSettings.noneFound": "未从支持的插件中找到可导入的设置。",
	"modals.importSettings.found":
		"找到 {source}。要将其代理配置导入 Agent Console 吗？",
	"modals.importSettings.defaultCommand": "（默认命令）",
	"modals.importSettings.keyPorted": "密钥已迁移",
	"modals.importSettings.keyMigrated": "密钥已转移",
	"modals.importSettings.needsRelink": "需要重新关联",
	"modals.importSettings.defaultAgentWithCustom":
		"默认代理：{agent} · {count} 个自定义代理",
	"modals.importSettings.defaultAgent": "默认代理：{agent}",
	"modals.importSettings.relinkWarning":
		"{count} 个 API 密钥无法自动迁移 — 导入后请在设置中重新关联。",
	"modals.importSettings.confirm": "导入",
	"modals.mcpAuth.placeholder": "重新验证 MCP 服务器…",
	"modals.mcpAuth.instructionOpen": "打开登录页面",
	"modals.mcpAuth.instructionCopy": "复制链接",
	"modals.mcpAuth.instructionDismiss": "关闭",
	"modals.mcpAuth.needsSignIn": "{server} – 需要登录",
	"modals.mcpAuth.opensWaiting": "将打开 {host} · 自 {when} 起等待",
	"modals.mcpAuth.waitingSince": "自 {when} 起等待",
	"modals.mcpAuth.emptyTitle": "没有等待中的登录请求",
	"modals.mcpAuth.emptyBody":
		"MCP 服务器只在代理启动时请求登录。请重新启动会话以再次检查 – 如果服务器的登录已过期，会出现新的提示。",
	"modals.mcpAuth.emptyWarning": "重新启动会中断代理当前在此标签页中的所有操作。",
	"modals.mcpAuth.restartSession": "重新启动会话",
	"modals.changeDirectory.title": "在目录中新建聊天",
	"modals.changeDirectory.body": "让代理在指定目录中工作，开始一个新的聊天会话。",
	"modals.changeDirectory.browse": "浏览...",
	"modals.changeDirectory.start": "开始",
	"modals.corruptionRecovery.title": "标签页状态损坏",
	"modals.corruptionRecovery.body":
		"无法恢复保存的标签页状态。原始数据显示在下方，供手动检查。",
	"modals.corruptionRecovery.retry": "重试恢复",
	"modals.corruptionRecovery.discard": "丢弃保存的状态",
	"modals.confirmReset.title": "重置 Obsidian 系统提示？",
	"modals.confirmReset.body":
		"这会重新打开所有开关，并清除你的仓库上下文和手动编辑过的提示。",
	"modals.confirmReset.warning": "此操作无法撤销。",
	"modals.confirmReset.confirm": "重置为默认值",
	"modals.sessionIntent.agentFallback": "新代理",
	"modals.sessionIntent.switchTitle": "切换到 {agent}？",
	"modals.sessionIntent.switchBody":
		"切换到 {agent} 会开始新的聊天。我们会把之前的消息交给 {agent}，让它了解上下文 — 但它不会拥有前一个代理的工具或工作记忆。\n\n当前对话会保存在历史中。",
	"modals.sessionIntent.switchConfirm": "切换并带上消息",
	"modals.sessionIntent.newChatTitle": "开始新聊天？",
	"modals.sessionIntent.newChatBody": "当前对话会保存在历史中。",
	"modals.sessionIntent.newChatConfirm": "新聊天",
	"modals.sessionIntent.reloadTitle": "重新加载 {agent}？",
	"modals.sessionIntent.reloadBody":
		"这会重新开始对话。当前对话会保存在历史中。",
	"modals.sessionIntent.reloadConfirm": "重新加载",
	"modals.deleteSession.title": "删除会话？",
	"modals.deleteSession.body": "确定要删除“{title}”吗？",
	"modals.deleteSession.hint":
		"这只会从此插件中移除该会话。会话数据仍会保留在代理端。",
	"modals.deleteSession.confirm": "删除",
	"modals.editTitle.title": "编辑会话标题",
	"modals.editTitle.save": "保存",
	"modals.sessionHistory.title": "会话历史",

	// ---- Phase 3: commands ----
	"commands.openChat": "打开聊天",
	"commands.focusNextView": "聚焦下一个聊天视图",
	"commands.focusPreviousView": "聚焦上一个聊天视图",
	"commands.closeSessionTab": "关闭会话标签页",
	"commands.nextSessionTab": "下一个会话标签页",
	"commands.previousSessionTab": "上一个会话标签页",
	"commands.showTabList": "显示标签页列表",
	"commands.reopenClosedTab": "重新打开已关闭的会话标签页",
	"commands.openSessionHistory": "打开会话历史",
	"commands.openNewView": "打开新视图",
	"commands.importSettings": "从其他代理插件导入设置",
	"commands.quickPromptsSearch": "快捷提示：搜索",
	"commands.quickPromptsNew": "快捷提示：新建提示",
	"commands.quickPromptsSaveComposer": "快捷提示：将输入框内容保存为提示",
	"commands.newChatWithAgent": "选择代理开始新聊天…",
	"commands.approvePermission": "批准当前权限请求",
	"commands.rejectPermission": "拒绝当前权限请求",
	"commands.toggleActiveNote": "在上下文中添加/移除当前笔记",
	"commands.newChat": "新聊天",
	"commands.cancelMessage": "取消当前消息",
	"commands.exportChat": "导出聊天",
	"commands.reloadSession": "重新加载会话",
	"commands.restartSessionFresh": "重新开始会话（全新）",
	"commands.reauthMcp": "重新验证 MCP 服务器",
	"commands.broadcastPrompt": "广播提示词",
	"commands.broadcastSend": "广播发送",
	"commands.broadcastCancel": "广播取消",
	// ---- Phase 3: chat header ----
	"chat.header.connecting": "连接中…",
	"chat.header.notConnected": "未连接",
	"chat.header.updatePill": "插件有可用更新！",
	"chat.header.updateTooltip": "打开社区插件以更新 Agent Console",
	"chat.header.reloadTooltip":
		"重新加载 — 恢复会话并保留对话。Shift-点击：重新开始 — 全新会话，清空对话。",
	"chat.header.sessionHistory": "会话历史",
	"chat.header.exportTooltip": "将聊天导出为 Markdown",
	"chat.header.more": "更多",
	"chat.header.tooltipPlugin": "插件：{value}",
	"chat.header.tooltipProfile": "配置：{value}",
	"chat.header.tooltipRuntime": "运行时：{value}",
	"chat.header.tooltipModel": "模型：{value}",
	// ---- Phase 3: more-menu + tab bar ----
	"chat.menu.switchAgent": "切换代理",
	"chat.menu.openNewView": "打开新视图",
	"chat.menu.newChatInDirectory": "在目录中新建聊天...",
	"chat.menu.pluginSettings": "插件设置",
	"chat.tabBar.rename": "重命名",
	"chat.tabBar.close": "关闭",
	"chat.tabBar.closeOthers": "关闭其他标签页",
	"chat.tabBar.closeToRight": "关闭右侧标签页",
	"chat.tabBar.closeTab": "关闭标签页",
	"chat.tabBar.newSessionTab": "新会话标签页",
	"chat.tabBar.tabList": "标签页列表",
	// ---- Phase 3: tab labels ----
	"chat.tabs.forkPrefix": "分支：{label}",
	"chat.tabs.sessionFallback": "会话",
	"chat.tabs.chatFallback": "聊天",
	"chat.tabs.defaultAgentSuffix": "{name}（默认）",
	// ---- Phase 3: composer + toolbar ----
	"chat.composer.queuedLocked": "已排队的消息（锁定）— 使用「编辑」修改",
	"chat.composer.edit": "编辑",
	"chat.composer.delete": "删除",
	"chat.composer.mode": "模式",
	"chat.composer.model": "模型",
	"chat.composer.selectMode": "选择模式",
	"chat.composer.selectModel": "选择模型",
	"chat.composer.stopGeneration": "停止生成",
	"chat.composer.sendMessage": "发送消息",
	"chat.composer.sendToConnect": "发送以连接",
	"chat.composer.connecting": "连接中...",
	"chat.composer.usageTokens": "{used} / {size} 个 token",
	"chat.composer.placeholder":
		"给 {agent} 发消息 - @ 提及笔记{commands}，! 使用快捷提示",
	"chat.composer.placeholderCommands": "，/ 使用命令",
	"chat.composer.placeholderStreaming":
		"排队一条消息 – 按 Enter 在 {agent} 完成后发送",
	"chat.composer.placeholderQueueSteer":
		"{queueKey} 排队 · {steerKey} 立即发送",
	"chat.composer.queuedBannerReady": "已排队 — {agent} 完成后发送",
	"chat.composer.queuedBannerWaiting": "已排队 — 准备就绪后发送",
	// ---- Phase 3: message list + landing ----
	"chat.messages.sending": "发送中…",
	"chat.messages.waitingForPermission": "等待权限中...",
	"chat.messages.restoringSession": "正在恢复会话...",
	"chat.messages.connectingTo": "正在连接 {agent}...",
	"chat.messages.sendToConnectTo": "发送一条消息以连接 {agent}...",
	"chat.messages.startConversation": "开始与 {agent} 对话...",
	"chat.messages.copyMessage": "复制消息",
	"chat.messages.attachedImage": "附加的图片",
	"chat.messages.unsupportedContent": "不支持的内容类型",
	"chat.landing.zeroTab": "没有打开的聊天。在下方输入即可开始。",
	"chat.landing.newChatWithAgent": "与代理开始新聊天",
	"chat.landing.openSessionHistory": "打开会话历史",
	"chat.landing.pickAgent": "选择一个代理开始",
	"chat.landing.detected": "在这台电脑上检测到：",
	"chat.landing.install": "安装",
	"chat.landing.installing": "安装中…",
	"chat.landing.copyCommand": "复制命令",
	"chat.landing.copied": "已复制！",
	"chat.landing.setupGuide": "设置指南",
	"chat.landing.installDidntFinish": "安装未完成。",
	"chat.landing.orSeparator": "，或 ",
	"chat.landing.listSeparator": "，",
	"chat.landing.openSettings": "打开设置",
	"chat.landing.redetect": "重新检测",
	"chat.landing.pathHint": "已经安装在其他位置？在设置中指定其路径。",
	"chat.landing.needAgentPrefix":
		"尚未安装任何代理。Agent Console 需要电脑上有一个 AI 代理 – ",
	// ---- Phase 3: context strip ----
	"chat.contextStrip.noActiveNote": "没有可固定的当前笔记",
	"chat.contextStrip.alreadyInContext": "{name} 已在上下文中",
	"chat.contextStrip.maxNotes": "上下文笔记最多 8 个。移除一个后再添加。",
	"chat.contextStrip.pin": "固定：{name}",
	"chat.contextStrip.removeNote": "从上下文中移除笔记",
	"chat.contextStrip.dontAddActiveNote": "不要将当前笔记加入此聊天的上下文",
	// ---- Phase 3: session history ----
	"chat.history.justNow": "刚刚",
	"chat.history.minutesAgo_one": "1 分钟前",
	"chat.history.minutesAgo_other": "{count} 分钟前",
	"chat.history.hoursAgo_one": "1 小时前",
	"chat.history.hoursAgo_other": "{count} 小时前",
	"chat.history.daysAgo": "{count} 天前",
	"chat.history.yesterday": "昨天",
	"chat.history.editTitle": "编辑会话标题",
	"chat.history.restoreSession": "恢复会话",
	"chat.history.forkSession": "将会话分支到新标签页",
	"chat.history.deleteSession": "删除会话",
	"chat.history.restore": "恢复",
	"chat.history.retry": "重试",
	"chat.history.local": "本地",
	"chat.history.agentBadge": "代理：{label}",
	"chat.history.synced": "已同步（{when}）",
	"chat.history.notSynced": "尚未同步",
	"chat.history.reconnectRefresh": "发送一条消息以重新连接并刷新",
	"chat.history.sendToConnect": "发送一条消息以连接",
	"chat.history.untitled": "未命名会话",
	"chat.history.noRestoreSupport": "此代理不支持恢复会话。",
	"chat.history.sessionSource": "会话来源",
	"chat.history.agentSessions": "代理服务器会话（{agent}）",
	"chat.history.noServerList":
		"{agent} 不在服务器上保存会话列表，因此只能查看本地历史。",
	"chat.history.searchPlaceholder": "搜索会话…",
	"chat.history.searchAria": "搜索会话",
	"chat.history.searchingTranscripts": "正在搜索对话记录…",
	"chat.history.onlyThisFolder": "仅此文件夹",
	"chat.history.onlyThisFolderTitle":
		"仅显示工作文件夹为此文件夹的会话。取消勾选可显示所有文件夹的会话。",
	"chat.history.loadingSessions": "正在加载会话…",
	"chat.history.noLocalWithCount":
		"还没有本地会话。你的代理有 {count} 个 — 在「代理」下查看。",
	"chat.history.noLocalMaybe":
		"还没有本地会话。你的代理可能保存了会话 — 在「代理」下查看。",
	"chat.history.viewAgentSessions": "查看代理会话",
	"chat.history.noMatch": "没有匹配搜索的会话",
	"chat.history.noPrevious": "没有以前的会话",
	"chat.history.loadMore": "加载更多",
	"chat.history.loading": "加载中…",
	// ---- Phase 3: quick prompts ----
	"chat.quickPrompts.queuedTooltip":
		"有一条消息在排队 — 编辑或删除它以发送其他内容",
	"chat.quickPrompts.newTabTooltip":
		"点击：在新标签页打开 · {mod}-点击：在后台打开 · {alt}-点击：放入输入框先编辑",
	"chat.quickPrompts.thisTabTooltip":
		"点击：在此聊天发送 · {mod}-点击：在新的后台标签页发送（加 {shift} 切换过去）· {alt}-点击：放入输入框先编辑",
	"chat.quickPrompts.showMore": "再显示 {count} 个 — 搜索所有快捷提示",
	"chat.quickPrompts.editPrompt": "编辑提示",
	"chat.quickPrompts.copyPrompt": "复制提示",
	"chat.quickPrompts.rename": "重命名",
	"chat.quickPrompts.addedToDraft": "已加入草稿 — 检查后发送",
	"chat.quickPrompts.needsSelection":
		"「{label}」需要选中文本 — 已放入输入框。",
	"chat.quickPrompts.startedInNewTab": "已在新标签页启动「{label}」。",
	"chat.quickPrompts.openedInNewTab": "已在新标签页打开「{label}」以供编辑。",
	"chat.quickPrompts.createFromMessage": "用这条消息创建快捷提示",
	"chat.quickPrompts.create": "创建快捷提示",
	"chat.quickPrompts.createFirst": "创建你的第一个快捷提示",
	"chat.quickPrompts.createNamed": "创建快捷提示「{query}」",
	"chat.quickPrompts.newPromptName": "新提示",
	// ---- Phase 3: A2UI interactive buttons ----
	"chat.a2ui.disabledStreaming": "此回复完成后可用",
	"chat.a2ui.disabledSending": "请等待当前回复完成",
	"chat.a2ui.disabledQueued": "已有一条消息在等待发送",
	"chat.a2ui.disabledRestoring": "正在先加载对话",
	"chat.a2ui.disabledPending": "正在发送你的选择…",
	"chat.a2ui.disabledAnswered": "已回答",
	"chat.a2ui.disabledSuperseded": "更新的选项在下方",
	"chat.a2ui.inertReason": "这些按钮无法安全显示，内容以代码形式保留。",
	// ---- Phase 3: banners, blocks, and errors ----
	"chat.carriedOver.title": "从 {agent} 延续的对话",
	"chat.carriedOver.show": "显示",
	"chat.carriedOver.hide": "隐藏",
	"chat.carriedOver.you": "你",
	"chat.carriedOver.assistant": "助手",
	"chat.errors.tabCrashTitle": "此标签页发生了错误",
	"chat.errors.retry": "重试",
	"chat.terminal.waitingForOutput": "等待输出...",
	"chat.terminal.noOutput": "无输出",
	"chat.terminal.exitCode": "退出代码：{code}",
	"chat.terminal.signal": " | 信号：{signal}",
	"chat.toolCall.title": "工具调用",
	"chat.toolCall.newFile": "新文件",
	"chat.toolCall.lines": "{count} 行",
	"chat.toolCall.collapsed": "已折叠。",
	"chat.toolCall.expanded": "已展开。",
	"chat.toolCall.contentRegion": "{title} 内容",
	"chat.toolCall.input": "输入",
	"chat.toolCall.output": "输出",
	"chat.mcpBanner.toolFailed": "服务器未登录，此工具失败。",
	"chat.mcpBanner.toolFailedOpens":
		"服务器未登录，此工具失败。将打开 {host}。",
	"chat.mcpBanner.looksLikeSignIn": "这看起来是登录问题",
	"chat.mcpBanner.mayNeedSignIn":
		"某个 MCP 服务器可能需要重新登录。重新开始会话即可收到新的登录请求。",
	"chat.mcpBanner.reauthenticate": "重新验证…",
	"chat.sharedLinks.none": "还没有共享链接",
	"chat.sharedLinks.count": "共享链接（{count}）",
	"chat.sharedLinks.countWithNew": "共享链接（{count}，{new} 个新）",
	"chat.lossyFallback.title": "从历史恢复的会话",
	"chat.lossyFallback.body":
		"原会话在代理端已不可用。我基于你之前对话的记录继续工作，但无法访问原会话的内部状态或之前的推理。部分工具输出也可能被截断。",
	"chat.historyBanner.notStored": "此标签页的历史未存储在本地。",
	"chat.historyBanner.reloading": "重新加载中…",
	"chat.historyBanner.reloadFromAgent": "从代理重新加载",
	"chat.notifications.permissionBody": "{agent} 正在请求权限。",
	// ---- Phase 3: boot registration labels ----
	"notices.bootPartHoverPreview": "笔记悬停预览",
	"notices.bootPartRibbon": "侧边栏按钮",
	"notices.bootPartCommands": "命令",
	"notices.bootPartSettingsTab": "设置选项卡",
	// ---- Phase 3 addendum ----
	"chat.notifications.responseComplete": "{agent} · 回复完成",
	"chat.picker.navigate": "导航",
	"chat.picker.addToContext": "加入上下文",
	"chat.picker.dismiss": "关闭",
	"chat.picker.run": "运行",
	"chat.picker.create": "创建",
	"chat.picker.newTab": "新标签页",
	"chat.picker.switch": "切换",
	"chat.picker.insert": "插入",
	"chat.picker.opensInNewTab": "在新标签页打开",
	"chat.picker.usesSelection": "使用选中文本",
	"chat.folderPicker.selectDirectory": "选择目录",
	"chat.acpErrors.titleProtocol": "协议错误",
	"chat.acpErrors.titleInvalidRequest": "无效请求",
	"chat.acpErrors.titleMethodNotSupported": "不支持的方法",
	"chat.acpErrors.titleInvalidParams": "无效参数",
	"chat.acpErrors.titleInternal": "内部错误",
	"chat.acpErrors.titleAuthRequired": "需要身份验证",
	"chat.acpErrors.titleResourceNotFound": "找不到资源",
	"chat.acpErrors.titleAgent": "代理错误",
	"chat.acpErrors.unexpected": "发生了意外错误。",
	"chat.acpErrors.suggestTooLong":
		"对话太长。可尝试压缩命令（如可用），或开始新聊天。",
	"chat.acpErrors.suggestBusy": "服务繁忙。请稍等片刻后重试。",
	"chat.acpErrors.suggestRestart": "请尝试重新开始代理会话。",
	"chat.acpErrors.suggestCheckConfig": "请在设置中检查代理配置。",
	"chat.acpErrors.suggestTryAgainRestart":
		"请重试，或重新开始代理会话。",
	"chat.acpErrors.suggestCheckAuth":
		"请检查是否已登录，或 API 密钥是否设置正确。",
	"chat.acpErrors.suggestCheckResource": "请检查文件或资源是否存在。",
	"chat.acpErrors.stderrApiKeyMissing":
		"代理的 API 密钥可能缺失。若为自定义代理，请在其环境变量设置中添加所需的 API 密钥（如 ANTHROPIC_API_KEY）。",
	"chat.acpErrors.stderrAuth":
		"代理报告了身份验证错误。请检查你的 API 密钥或凭据是否有效。",
	"chat.acpErrors.cantStartTitle": "无法启动 {agent}",
	"chat.acpErrors.notInstalled":
		"{agent} 似乎未安装（无法运行 \"{command}\"）。请安装它，或打开设置指定其路径。",
	"chat.acpErrors.startupErrorTitle": "代理启动错误",
	"chat.acpErrors.failedToStart": "启动 {agent} 失败：{message}",
	"chat.acpErrors.checkAgentConfig": "请在设置中检查代理配置。",
	"chat.acpErrors.pathHintWsl":
		"1. 核对代理路径：在 WSL 终端运行 \"which {command}\" 找到正确路径。2. 如果代理需要 Node.js，请同时在常规设置中确认 Node.js 路径（用 \"which node\" 查找）。",
	"chat.acpErrors.pathHintWin":
		"1. 核对代理路径：在命令提示符运行 \"where {command}\" 找到正确路径。2. 如果代理需要 Node.js，请同时在常规设置中确认 Node.js 路径（用 \"where node\" 查找）。",
	"chat.acpErrors.pathHintUnix":
		"1. 核对代理路径：在终端运行 \"which {command}\" 找到正确路径。2. 如果代理需要 Node.js，请同时在常规设置中确认 Node.js 路径（用 \"which node\" 查找）。",
	"chat.acpErrors.cannotSendTitle": "无法发送消息",
	"chat.acpErrors.noActiveSession": "没有活动会话。请等待连接。",
	"chat.acpErrors.sendFailedTitle": "消息发送失败",
	"chat.acpErrors.sendFailed": "消息发送失败",
	"chat.acpErrors.permissionErrorTitle": "权限错误",
	"chat.acpErrors.permissionRespondFailed":
		"响应权限请求失败：{message}",
	"chat.acpErrors.errorOccurred": "发生了错误",
	"chat.acpErrors.agentNotFoundTitle": "找不到代理",
	"chat.acpErrors.agentNotFound":
		"在设置中找不到 ID 为 \"{agentId}\" 的代理",
	"chat.acpErrors.checkYourAgentConfig": "请在设置中检查你的代理配置。",
	"chat.acpErrors.sessionCreationFailedTitle": "会话创建失败",
	"chat.acpErrors.sessionCreationFailed": "创建新会话失败：{message}",
	"chat.acpErrors.checkConfigTryAgain": "请检查代理配置后重试。",
	"chat.history.failedFetch": "获取会话失败：{message}",
	"chat.history.failedLoadMore": "加载更多会话失败：{message}",
	"chat.history.failedRestore": "恢复会话失败：{message}",
	"chat.history.failedFork": "分支会话失败：{message}",
	"chat.history.failedDelete": "删除会话失败：{message}",
	"chat.history.failedUpdateTitle": "更新标题失败：{message}",
	"chat.installer.noNpm":
		"找不到 npm。请安装 Node.js（自带 npm）后重试，或复制命令到终端运行。",
	"chat.installer.needsPermission":
		"此安装需要当前账户没有的权限。请复制命令到终端运行（可能需要 sudo）。",
	"chat.installer.noNetwork":
		"无法联网安装。请检查网络后重试，或复制命令到终端运行。",
	"chat.installer.didntFinish":
		"安装未完成。请复制命令到终端运行以查看完整错误。",
	"chat.updateBanner.migrationTitle": "需要迁移软件包",
	"chat.updateBanner.renamed":
		"\"{old}\" 已更名为 \"{new}\"。\n请在终端运行以下命令：",
	"chat.updateBanner.updateTitle": "代理有可用更新",
	"chat.updateBanner.updateAvailable":
		"{package}：{current} → {latest}。\n请在终端运行以下命令：",
	"modals.mcpAuth.linkExpiry":
		"登录链接会在一段时间后过期 – 如果页面显示错误，请重新开始会话获取新链接。",
});
