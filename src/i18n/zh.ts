/**
 * Simplified Chinese (中文) string catalog — settings surface.
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
});
