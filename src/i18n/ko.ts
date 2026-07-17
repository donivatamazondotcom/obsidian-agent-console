/**
 * Korean (한국어) string catalog — settings, notices, and modals (phases 1–2).
 *
 * Factory-wrapped: instantiated only when Korean is the active locale.
 * Partial against the English contract; missing keys fall back to English.
 * Keys holding literal values (example commands, folder names, KEY=VALUE
 * samples) are intentionally omitted — the English/literal value is
 * correct for every locale.
 *
 * Machine-translated baseline pending native-speaker review (smoke test
 * tracked in the vault spec). Corrections welcome.
 */
import type { en } from "./en";

export const ko = (): Partial<Record<keyof typeof en, string>> => ({
	"settings.heading.agents": "에이전트",
	"settings.defaultWorkingDirectory.name": "기본 작업 디렉터리",
	"settings.defaultWorkingDirectory.placeholder":
		"비워 두면 보관소 루트를 사용합니다",
	"settings.defaultWorkingDirectory.button": "찾아보기…",
	"settings.defaultWorkingDirectory.tooltip": "폴더 선택",
	"settings.heading.builtInAgents": "기본 제공 에이전트",
	"settings.heading.customAgents": "사용자 지정 에이전트",
	"settings.heading.chatBehavior": "채팅 동작",
	"settings.activeNoteAsDefault.name": "활성 노트를 기본 컨텍스트로 사용",
	"settings.sessionTitle.name": "세션 제목",
	"settings.quickPromptsFolder.name": "빠른 프롬프트 폴더",
	"settings.sendMessageShortcut.name": "메시지 전송 단축키",
	"settings.yourVaultContext.name": "내 보관소 컨텍스트",
	"settings.editTheFullPrompt.name": "전체 프롬프트 편집",
	"settings.editTheFullPrompt.button": "전체 프롬프트 편집…",
	"settings.fullPrompt.name": "전체 프롬프트",
	"settings.backToOptions.name": "옵션으로 돌아가기",
	"settings.backToOptions.button": "옵션으로 돌아가기",
	"settings.whatGetsSent.name": "전송되는 내용",
	"settings.resetToDefaults.name": "기본값으로 재설정",
	"settings.resetToDefaults.button": "기본값으로 재설정",
	"settings.heading.appearanceNotifications": "모양 및 알림",
	"settings.sidebarSide.name": "사이드바 위치",
	"settings.sidebarSide.desc": "새 채팅 화면을 열 사이드바를 선택합니다",
	"settings.chatFontSize.name": "채팅 글꼴 크기",
	"settings.showEmojis.name": "이모지 표시",
	"settings.systemNotifications.name": "시스템 알림",
	"settings.heading.tabs": "탭",
	"settings.restoreTabsOnStartup.name": "시작 시 탭 복원",
	"settings.confirmBeforeClosingMultiple.name":
		"여러 채팅을 닫기 전에 확인",
	"settings.heading.permissions": "권한",
	"settings.autoAllowPermissions.name": "권한 자동 허용",
	"settings.exportFolder.name": "내보내기 폴더",
	"settings.exportFolder.desc": "채팅 내보내기 파일이 저장될 폴더",
	"settings.filename.name": "파일 이름",
	"settings.frontmatterTag.name": "프런트매터 태그",
	"settings.includeImages.name": "이미지 포함",
	"settings.includeImages.desc":
		"내보낸 마크다운 파일에 이미지를 포함합니다",
	"settings.imageLocation.name": "이미지 저장 위치",
	"settings.imageLocation.desc": "내보낸 이미지를 저장할 위치",
	"settings.customImageFolder.name": "사용자 지정 이미지 폴더",
	"settings.autoExportOnNew.name": "새 채팅 시 자동 내보내기",
	"settings.autoExportOnClose.name": "채팅을 닫을 때 자동 내보내기",
	"settings.openNoteAfterExport.name": "내보낸 후 노트 열기",
	"settings.openNoteAfterExport.desc":
		"내보내기가 끝나면 해당 노트를 자동으로 엽니다",
	"settings.nodeJsPath.name": "Node.js 경로",
	"settings.heading.windowsSubsystemForLinux":
		"Windows Subsystem for Linux",
	"settings.enableWslMode.name": "WSL 모드 사용",
	"settings.wslDistribution.name": "WSL 배포판",
	"settings.wslDistribution.placeholder": "비워 두면 기본 배포판을 사용합니다",
	"settings.debugMode.name": "디버그 모드",
	"settings.defaultAgent.name": "기본 에이전트",
	"settings.defaultAgent.desc":
		"새 채팅 화면을 열 때 사용할 에이전트를 선택합니다.",
	"settings.apiKey.name": "API 키",
	"settings.path.name": "경로",
	"settings.arguments.name": "인수",
	"settings.environmentVariables.name": "환경 변수",
	"settings.authentication.name": "인증",
	"settings.path.name2": "경로",
	"settings.arguments.name2": "인수",
	"settings.environmentVariables.name2": "환경 변수",
	"settings.setup.name": "설정",
	"settings.path.name3": "경로",
	"settings.arguments.name3": "인수",
	"settings.environmentVariables.name3": "환경 변수",
	"settings.apiKey.name2": "API 키",
	"settings.path.name4": "경로",
	"settings.arguments.name4": "인수",
	"settings.environmentVariables.name4": "환경 변수",
	"settings.apiKey.name3": "API 키",
	"settings.path.name5": "경로",
	"settings.arguments.name5": "인수",
	"settings.environmentVariables.name5": "환경 변수",
	"settings.environmentVariables.button": "사용자 지정 에이전트 추가",
	"settings.agentId.name": "에이전트 ID",
	"settings.agentId.desc": "이 에이전트를 가리키는 고유 식별자입니다.",
	"settings.agentId.tooltip": "이 에이전트 삭제",
	"settings.displayName.name": "표시 이름",
	"settings.displayName.desc": "메뉴와 헤더에 표시됩니다.",
	"settings.path.name6": "경로",
	"settings.path.placeholder6": "명령 이름 또는 경로",
	"settings.arguments.name6": "인수",
	"settings.environmentVariables.name6": "환경 변수",
	"settings.environmentVariables.button2": "복사",
	"settings.environmentVariables.button3": "복사됨!",
	"settings.environmentVariables.button4": "복사",
	"settings.environmentVariables.button5": "자동 감지",
	"settings.environmentVariables.button6": "감지 중…",
	"settings.environmentVariables.button7": "찾을 수 없음",
	"settings.environmentVariables.button8": "자동 감지",
	"settings.environmentVariables.button9": "오류",
	"settings.environmentVariables.button10": "자동 감지",
	"settings.importSettingsFromAnother.name":
		"다른 플러그인에서 설정 가져오기",
	"settings.importSettingsFromAnother.button": "가져오기…",
	"settings.workingDirectory.name": "작업 디렉터리",
	"settings.workingDirectory.placeholder":
		"비워 두면 전역 기본값을 사용합니다",
	"settings.workingDirectory.button": "찾아보기…",
	"settings.workingDirectory.tooltip": "폴더 선택",
	"settings.activeNoteAsDefault.desc":
		"새 채팅의 컨텍스트 스트립에 활성 노트를 자동으로 추가합니다. 잡기 버튼으로 언제든지 노트를 직접 고정할 수 있습니다.",
	"settings.sessionTitle.desc":
		"새 채팅의 탭 이름을 만드는 방식입니다. '에이전트 제안'은 첫 응답에서 에이전트에게 짧은 제목을 요청하고, 제목이 도착할 때까지 첫 메시지를 임시로 사용합니다. 탭 이름은 언제든지 직접 바꿀 수 있습니다.",
	"settings.quickPromptsFolder.desc":
		"빠른 프롬프트를 검색할 보관소 폴더입니다. 프롬프트 하나당 마크다운 노트 하나를 사용합니다. 노트의 설명(또는 이름/제목/파일 이름)이 레이블이 되고 본문이 프롬프트 내용이 됩니다. 변경 사항은 실시간으로 반영됩니다.",
	"settings.sendMessageShortcut.desc":
		"메시지를 보낼 키보드 단축키를 선택합니다. 참고: Cmd/Ctrl+Enter를 사용하는 경우 해당 키에 지정된 다른 단축키를 해제해야 할 수 있습니다(설정 → 단축키).",
	"settings.sendMessageShortcut.desc2":
		"각 채팅의 첫 메시지와 함께 에이전트에 전송되어 Obsidian에서 자연스럽게 동작하도록 돕습니다. 대부분 그대로 두면 됩니다.",
	"settings.yourVaultContext.desc":
		"에이전트에게 전하는 나만의 메모입니다. 파일 위치, 이름 짓기와 링크 규칙, 선호하는 말투 등을 적습니다. 프롬프트 끝에 추가되며 이 보관소의 모든 채팅에 동일하게 적용됩니다.",
	"settings.editTheFullPrompt.desc":
		"고급: 프롬프트 전체를 직접 편집합니다. 아래 표시된 텍스트가 미리 채워진 상태로 열립니다.",
	"settings.fullPrompt.desc":
		"프롬프트 전체를 직접 편집하고 있습니다. 스위치 설정은 이 텍스트에 반영되어 더 이상 별도로 적용되지 않으며, 아래 미리보기가 실제 전송 내용 그대로를 보여 줍니다.",
	"settings.backToOptions.desc":
		"스위치 설정으로 돌아갑니다. 직접 편집한 텍스트는 다시 돌아올 때를 위해 보관됩니다.",
	"settings.whatGetsSent.desc":
		"첫 메시지에서 에이전트가 받는 텍스트를 그대로 보여 주는 읽기 전용 미리보기입니다.",
	"settings.whatGetsSent.desc2":
		"노트 관련 내용은 채팅 폴더가 보관소 안에 있을 때만 전송됩니다.",
	"settings.resetToDefaults.desc":
		"모든 스위치를 켜고, 보관소 컨텍스트와 직접 편집한 프롬프트를 지운 뒤 옵션 화면으로 돌아갑니다.",
	"settings.showEmojis.desc":
		"도구 호출, 사고 과정, 계획, 터미널 블록에 이모지 아이콘을 표시합니다.",
	"settings.systemNotifications.desc":
		"에이전트가 응답을 마치거나 권한을 요청할 때 알림을 표시합니다. 완료 알림에는 탭 이름이 표시되며 클릭하면 해당 탭으로 이동합니다. Obsidian 창을 보고 있는 동안에는 알림이 표시되지 않습니다.",
	"settings.restoreTabsOnStartup.desc":
		"Obsidian을 종료할 때 열린 탭을 저장하고 다음 실행 시 복원합니다. 각 화면은 자신의 탭을 독립적으로 복원합니다.",
	"settings.confirmBeforeClosingMultiple.desc":
		"열린 채팅이 2개 이상일 때 Cmd+W로 패널을 닫기 전에 경고하여 실행 중인 여러 에이전트를 한꺼번에 잃지 않도록 합니다.",
	"settings.autoAllowPermissions.desc":
		"에이전트의 모든 권한 요청을 자동으로 허용합니다. ⚠️ 주의해서 사용하세요. 에이전트에게 시스템 전체 접근 권한을 부여합니다.",
	"settings.filename.desc":
		"내보내기 파일 이름 템플릿입니다. 날짜는 {date}, 시간은 {time}을 사용하세요",
	"settings.frontmatterTag.desc":
		"내보낸 노트에 추가할 태그입니다. 중첩 태그를 지원합니다(예: projects/agent-console). 비워 두면 사용하지 않습니다.",
	"settings.customImageFolder.desc":
		"내보낸 이미지를 저장할 폴더 경로입니다(보관소 루트 기준)",
	"settings.autoExportOnNew.desc":
		"새 채팅을 시작할 때 현재 채팅을 자동으로 내보냅니다",
	"settings.autoExportOnClose.desc":
		"채팅 화면을 닫을 때 현재 채팅을 자동으로 내보냅니다",
	"settings.nodeJsPath.desc":
		"Node.js 경로입니다. 보통 비워 둡니다. node가 일반적이지 않은 위치에 있을 때만 필요합니다(절대 경로 입력, 예: /usr/local/bin/node).",
	"settings.nodeJsPath.placeholder": "비워 두면 로그인 셸이 자동으로 찾습니다",
	"settings.enableWslMode.desc":
		"에이전트를 Windows Subsystem for Linux 안에서 실행합니다. Codex처럼 네이티브 Windows 환경에서 잘 동작하지 않는 에이전트에 권장합니다.",
	"settings.wslDistribution.desc":
		"WSL 배포판 이름을 지정합니다(비워 두면 기본값). 예: Ubuntu, Debian",
	"settings.debugMode.desc":
		"콘솔에 디버그 로그를 출력합니다. 개발과 문제 해결에 유용합니다.",
	"settings.apiKey.desc":
		"Gemini API 키입니다. Google 계정으로 로그인하지 않는 경우 필요합니다. Obsidian 키체인에서 선택하거나 새 시크릿을 만드세요.",
	"settings.environmentVariables.desc":
		"KEY=VALUE 쌍을 한 줄에 하나씩 입력하세요. Vertex AI 인증에 필요합니다. GEMINI_API_KEY는 위 필드에서 자동으로 가져옵니다.",
	"settings.authentication.desc":
		"KEY=VALUE 쌍을 한 줄에 하나씩 입력하세요. 특별히 필요하지 않으면 비워 두세요.",
	"settings.setup.desc":
		"KEY=VALUE 쌍을 한 줄에 하나씩 입력하세요. OpenCode 프로세스에만 적용되며 모델 백엔드에는 적용되지 않습니다. 예를 들어 로컬 모델의 컨텍스트 길이는 여기가 아니라 ollama 서버에서 설정합니다(OLLAMA_CONTEXT_LENGTH). 특별히 필요하지 않으면 비워 두세요.",
	"settings.setup.desc2":
		"Anthropic API 키입니다. Anthropic 계정으로 로그인하지 않는 경우 필요합니다. Obsidian 키체인에서 선택하거나 새 시크릿을 만드세요.",
	"settings.setup.desc3":
		"인수를 공백이나 줄 바꿈으로 구분해 입력하세요. 공백이 포함된 인수는 따옴표로 감싸세요. 비워 두면 인수 없이 실행합니다.",
	"settings.setup.desc4":
		"KEY=VALUE 쌍을 한 줄에 하나씩 입력하세요. ANTHROPIC_API_KEY는 위 필드에서 자동으로 가져옵니다.",
	"settings.setup.desc5":
		"OpenAI API 키입니다. OpenAI 계정으로 로그인하지 않는 경우 필요합니다. Obsidian 키체인에서 선택하거나 새 시크릿을 만드세요.",
	"settings.setup.desc6":
		"인수를 공백이나 줄 바꿈으로 구분해 입력하세요. 공백이 포함된 인수는 따옴표로 감싸세요. 비워 두면 인수 없이 실행합니다.",
	"settings.setup.desc7":
		"KEY=VALUE 쌍을 한 줄에 하나씩 입력하세요. OPENAI_API_KEY는 위 필드에서 자동으로 가져옵니다.",
	"settings.displayName.desc2":
		"사용자 지정 에이전트의 명령 이름 또는 경로입니다. 명령 이름만 입력하면 로그인 셸이 찾아 주고, 절대 경로를 입력할 수도 있습니다.",
	"settings.displayName.desc3":
		"인수를 공백이나 줄 바꿈으로 구분해 입력하세요. 공백이 포함된 인수는 따옴표로 감싸세요. 비워 두면 인수 없이 실행합니다.",
	"settings.displayName.desc4":
		"KEY=VALUE 쌍을 한 줄에 하나씩 입력하세요. (일반 텍스트로 저장됩니다)",
	"settings.importSettingsFromAnother.desc":
		"다른 에이전트 플러그인(예: Agent Client)에서 에이전트 정의, 기본값, API 키를 가져옵니다. 적용 전에 미리보기를 보여 줍니다.",
	"settings.path.desc":
		'Gemini CLI의 명령 이름 또는 경로입니다. "gemini"만 입력하면 로그인 셸이 찾아 주고, 특정 버전을 쓰려면 절대 경로를 입력하세요.',
	"settings.arguments.desc":
		'인수를 공백이나 줄 바꿈으로 구분해 입력하세요. 공백이 포함된 인수는 따옴표로 감싸세요. 비워 두면 인수 없이 실행합니다. (현재 Gemini CLI는 "--experimental-acp" 옵션이 필요합니다.)',
	"settings.authentication.desc2":
		'Kiro CLI는 Kiro 계정으로 로그인하므로 API 키가 필요 없습니다. 터미널에서 "kiro-cli"를 한 번 실행해 로그인한 뒤 여기서 Kiro CLI를 선택하세요.',
	"settings.path.desc2":
		'kiro-cli의 명령 이름 또는 경로입니다. "kiro-cli"만 입력하면 로그인 셸이 찾아 주고, 절대 경로를 입력할 수도 있습니다(보통 ~/.local/bin/kiro-cli).',
	"settings.arguments.desc2":
		'인수를 공백이나 줄 바꿈으로 구분해 입력하세요. 공백이 포함된 인수는 따옴표로 감싸세요. Kiro CLI는 "acp" 하위 명령이 필요합니다.',
	"settings.setup.desc8":
		"OpenCode는 자체 설정에서 모델과 로그인을 관리하므로 여기에 API 키가 필요 없습니다. opencode.ai의 한 줄 설치 명령으로 설치한 뒤 OpenCode를 선택하세요. 로컬 모델을 오프라인으로 실행하려면 OpenCode 설정에서 ollama를 지정하세요. OpenCode 설정 가이드를 참고하세요.",
	"settings.path.desc3":
		'opencode의 명령 이름 또는 경로입니다. "opencode"만 입력하면 로그인 셸이 찾아 주고, 절대 경로를 입력할 수도 있습니다(보통 ~/.opencode/bin/opencode).',
	"settings.arguments.desc3":
		'인수를 공백이나 줄 바꿈으로 구분해 입력하세요. 공백이 포함된 인수는 따옴표로 감싸세요. OpenCode는 "acp" 하위 명령이 필요합니다.',
	"settings.path.desc4":
		'claude-agent-acp의 명령 이름 또는 경로입니다. "claude-agent-acp"만 입력하면 로그인 셸이 찾아 주고, 절대 경로를 입력할 수도 있습니다.',
	"settings.path.desc5":
		'codex-acp의 명령 이름 또는 경로입니다. "codex-acp"만 입력하면 로그인 셸이 찾아 주고, 절대 경로를 입력할 수도 있습니다.',
	"settings.fontSize.desc":
		"채팅 메시지 영역의 글꼴 크기를 조절합니다({min}-{max}px).",
	"settings.autoDetect.tooltip":
		"`{lookupCmd} {commandName}` 명령으로 경로를 찾습니다",
	"notices.agentIdInUse":
		'에이전트 ID "{desired}"은(는) 이미 사용 중이라 "{unique}"(으)로 변경했습니다.',
	"settings.docLink.prefix": "도움이 필요하신가요? ",
	"settings.docLink.linkText": "문서",
	"settings.docLink.suffix": "를 확인해 보세요.",
	"settings.customAgents.emptyState":
		"아직 설정된 사용자 지정 에이전트가 없습니다.",
	"settings.language.name": "언어",
	"settings.language.desc": "이 플러그인의 버튼, 메뉴, 메시지에 사용할 언어입니다. '자동'은 Obsidian의 언어 설정을 따릅니다.",
	"settings.language.optionAuto": "자동 (Obsidian과 동일)",
	"settings.language.reloadNotice": "언어는 Obsidian을 다시 시작한 후에 바뀝니다.",
	"settings.section.obsidianSystemPrompt": "Obsidian 시스템 프롬프트",
	"settings.section.export": "내보내기",
	"settings.section.advanced": "고급",
	"settings.sidebarSide.optionRight": "오른쪽 사이드바",
	"settings.sidebarSide.optionLeft": "왼쪽 사이드바",
	"settings.sendMessageShortcut.optionEnter": "Enter로 전송, Shift+Enter로 줄 바꿈",
	"settings.sendMessageShortcut.optionCmdEnter": "Cmd/Ctrl+Enter로 전송, Enter로 줄 바꿈",
	"settings.imageLocation.optionObsidian": "Obsidian의 첨부 파일 설정 사용",
	"settings.imageLocation.optionCustom": "사용자 지정 폴더에 저장",
	"settings.imageLocation.optionBase64": "Base64로 포함 (권장하지 않음)",
	"settings.sessionTitle.optionAgentSuggested": "에이전트가 첫 응답에서 제안",
	"settings.sessionTitle.optionPromptDerived": "내 첫 메시지에서 생성",
	"settings.sessionTitle.optionAgentTimestamp": "에이전트 이름과 시간",
	"settings.obsidianPrompt.hostIdentity.name": "Obsidian에서 실행 중임을 알리기",
	"settings.obsidianPrompt.hostIdentity.desc": "에이전트에게 Obsidian 앱 안에서 작업 중임을 알려 줍니다.",
	"settings.obsidianPrompt.rendering.name": "응답 표시 방식 설명하기",
	"settings.obsidianPrompt.rendering.desc": "링크, 수식, 다이어그램이 올바르게 표시되도록 응답 형식을 알려 주고, 노트를 쓸 때 따라야 할 Obsidian 규칙을 전달합니다.",
	"settings.obsidianPrompt.workingDirectory.name": "작업 폴더 공유하기",
	"settings.obsidianPrompt.workingDirectory.desc": "이 채팅이 어느 폴더에서 작업 중인지 에이전트에게 알려 줍니다.",
	"settings.obsidianPrompt.vaultCollaboration.name": "내 노트로 작업 허용하기",
	"settings.obsidianPrompt.vaultCollaboration.desc": "에이전트가 노트를 읽고 편집할 수 있음을 알려 줍니다. 채팅이 보관소 안에서 실행될 때만 전송됩니다.",
	"settings.obsidianPrompt.previewEmpty": "(시스템 프롬프트가 전송되지 않습니다. 에이전트는 Obsidian 컨텍스트를 받지 않습니다.)",
	"settings.defaultWorkingDirectory.desc": "새 채팅이 시작되는 디렉터리입니다. 비워 두면 보관소 루트를 사용합니다. 기존 채팅과 복원된 채팅은 자기 디렉터리를 유지합니다.",
	"settings.defaultWorkingDirectory.statusVaultRoot": "현재: 보관소 루트{root}.",
	"settings.defaultWorkingDirectory.statusInvalid": "⚠ \"{value}\"은(는) 유효한 절대 경로가 아니므로 새 채팅은 보관소 루트{root}를 사용합니다.",
	"settings.defaultWorkingDirectory.statusResolved": "확인된 경로: {dir}.",
	"settings.chatFontSize.placeholderCurrent": "{px} (현재 값)",
	"settings.installHint.prefix": "설치가 안 되어 있나요? 터미널에서 실행하세요: ",
	"settings.agentWorkingDirectory.desc": "이 에이전트의 새 채팅이 시작되는 폴더입니다. 비워 두면 전역 기본 작업 디렉터리를, 그다음 보관소 루트를 사용합니다.",
	"settings.agentWorkingDirectory.sourceGlobal": " (전역 기본값)",
	"settings.agentWorkingDirectory.sourceVaultRoot": " (보관소 루트)",
	"settings.agentWorkingDirectory.statusCurrent": "현재: {dir}{label}.",
	"settings.agentWorkingDirectory.statusInvalid": "⚠ \"{value}\"은(는) 유효한 절대 경로가 아니므로 {dir}을(를) 사용합니다.",
	"settings.agentWorkingDirectory.statusResolved": "확인된 경로: {dir}.",
	"settings.defaultWorkingDirectory.pickerTitle": "기본 작업 디렉터리 선택",
	"settings.workingDirectory.pickerTitle": "작업 디렉터리 선택",
	"settings.customAgents.defaultName": "사용자 지정 에이전트",
	// --- Phase 2: notices ---
	"notices.quickPromptCollided":
		'[Agent Console] 같은 이름의 빠른 프롬프트가 이미 있어 "{basename}"(으)로 저장했습니다.',
	"notices.quickPromptCreated":
		'[Agent Console] 빠른 프롬프트 "{basename}"을(를) 만들었습니다.',
	"notices.quickPromptCreateFailed":
		"[Agent Console] 빠른 프롬프트를 만들 수 없습니다 — 콘솔을 확인하세요.",
	"notices.quickPromptNoteNotFound":
		'[Agent Console] "{label}"을(를) 열 수 없습니다 — 노트를 찾지 못했습니다.',
	"notices.promptTextCopied": "[Agent Console] 프롬프트 텍스트를 복사했습니다.",
	"notices.promptTextCopyFailed":
		"[Agent Console] 프롬프트 텍스트를 복사할 수 없습니다 — 콘솔을 확인하세요.",
	"notices.quickPromptRenameFailed":
		"[Agent Console] 빠른 프롬프트의 이름을 바꿀 수 없습니다 — 콘솔을 확인하세요.",
	"notices.noQuickPromptsFound":
		'[Agent Console] 빠른 프롬프트가 없습니다. "{folder}" 폴더에 마크다운 노트를 추가하세요.',
	"notices.noChatTabsOpen": "[Agent Console] 열린 채팅 탭이 없습니다",
	"notices.noPromptToBroadcast": "[Agent Console] 전송할 프롬프트가 없습니다",
	"notices.noOtherTabsToBroadcast":
		"[Agent Console] 프롬프트를 전달할 다른 채팅 탭이 없습니다",
	"notices.broadcastSkipNote": " ({count}개 건너뜀 — 대기 중인 메시지 있음)",
	"notices.promptBroadcast":
		"[Agent Console] {count}개 탭에 프롬프트를 전달했습니다{skipNote}",
	"notices.noTabsReadyToSend": "[Agent Console] 보낼 준비가 된 탭이 없습니다",
	"notices.sentInTabs": "[Agent Console] {count}개 탭에서 보냈습니다{skipNote}",
	"notices.cancelBroadcast":
		"[Agent Console] {count}개 탭에 취소를 전달했습니다",
	"notices.contextStripMigration":
		"Agent Console: 활성 노트가 더 이상 채팅을 따라가지 않습니다. 새 컨텍스트 스트립으로 노트를 컨텍스트에 고정하세요.",
	"notices.importSettingsFound":
		"Agent Console: {plugin} 설정을 찾았습니다 — 클릭하여 가져오세요.",
	"notices.apiKeyMigrated":
		'[Agent Console] {agent} API 키가 Obsidian 키체인에 "{secretId}"(으)로 이전되었습니다.',
	"notices.apiKeyMigratedFallback":
		'[Agent Console] "{defaultId}"이(가) 이미 사용 중이라 {agent} API 키를 "{fallbackId}"(으)로 이전했습니다. Obsidian 키체인 설정에서 이름을 바꿀 수 있습니다.',
	"notices.updateAvailable": "[Agent Console] 업데이트 가능: v{version}",
	"notices.chatExported": "[Agent Console] 채팅을 {path}에 내보냈습니다",
	"notices.chatExportFailed": "[Agent Console] 채팅 내보내기에 실패했습니다",
	"notices.alreadyNewSession": "[Agent Console] 이미 새 세션입니다",
	"notices.newSessionFailed": "[Agent Console] 새 세션을 만들지 못했습니다",
	"notices.noMessagesToExport": "[Agent Console] 내보낼 메시지가 없습니다",
	"notices.sessionRestartedFresh": "[Agent Console] 세션을 새로 시작했습니다",
	"notices.sessionReloading": "[Agent Console] 세션을 다시 불러오는 중…",
	"notices.sessionReloaded": "[Agent Console] 세션을 다시 불러왔습니다",
	"notices.sessionReloadedFresh":
		"[Agent Console] 이 에이전트는 이어하기를 지원하지 않아 새 세션으로 다시 시작했습니다 (표시된 기록은 로컬입니다)",
	"notices.sessionReloadFailed":
		"[Agent Console] 세션을 다시 불러오지 못했습니다",
	"notices.invalidWorkingDirectory":
		"Agent Console: 설정된 작업 디렉터리가 유효한 절대 경로가 아닙니다. 새 채팅을 {dir}에서 시작했습니다.",
	"notices.newChatStartedIn": "Agent Console: {dir}에서 새 채팅을 시작했습니다",
	"notices.contextNoteDeleted":
		'[Agent Console] 컨텍스트 노트 "{name}"이(가) 삭제되어 채팅 컨텍스트에서 제거했습니다.',
	"notices.noActivePermissionRequest":
		"[Agent Console] 대기 중인 권한 요청이 없습니다",
	"notices.maxAttachments":
		"[Agent Console] 첨부 파일은 최대 {count}개까지 가능합니다",
	"notices.imageTooLarge": "[Agent Console] 이미지가 너무 큽니다 (최대 {size}MB)",
	"notices.imageAttachFailed": "[Agent Console] 이미지를 첨부하지 못했습니다",
	"notices.filePathUndetermined":
		"[Agent Console] 파일 경로를 확인할 수 없습니다",
	"notices.imagePasteConnecting":
		"[Agent Console] 아직 에이전트에 연결 중입니다 – 잠시 후 이미지를 다시 붙여넣으세요.",
	"notices.imagePasteUnsupported":
		"[Agent Console] 이 에이전트는 이미지 붙여넣기를 지원하지 않습니다. 드래그 앤 드롭을 사용해 보세요.",
	"notices.tabRestoreCorrupted":
		"이전 탭을 복원할 수 없습니다 — 저장된 상태가 손상되었습니다.",
	"notices.viewDetails": "자세히 보기",
	"notices.noRecentlyClosedSession": "다시 열 최근 닫은 세션이 없습니다",
	"notices.duplicateTabName": "[Agent Console] 같은 이름의 탭이 이미 있습니다",
	"notices.sessionRestoreFailed": "[Agent Console] 세션을 복원하지 못했습니다",
	"notices.sessionForkFailed": "[Agent Console] 세션을 분기하지 못했습니다",
	"notices.sessionDeleted": "[Agent Console] 세션을 삭제했습니다",
	"notices.sessionDeleteFailed": "[Agent Console] 세션을 삭제하지 못했습니다",
	"notices.titleUpdated": "[Agent Console] 제목을 변경했습니다",
	"notices.titleUpdateFailed": "[Agent Console] 제목을 변경하지 못했습니다",
	"notices.titleEmpty": "제목을 비워 둘 수 없습니다",
	"notices.settingsImported":
		"Agent Console: {source}에서 설정을 가져왔습니다.{relinkMsg}",
	"notices.settingsImportedRelink":
		" 설정에서 API 키 {count}개를 다시 연결하세요.",
	"notices.settingsImportFailed": "Agent Console: 가져오기에 실패했습니다. {error}",
	"notices.mcpSignInLinkCopied": '"{server}" 로그인 링크를 복사했습니다',
	"notices.mcpNeedsSignInTitle": 'MCP 서버 "{server}"에 로그인이 필요합니다',
	"notices.mcpOpensHost": "{host} 열기",
	"notices.mcpSignIn": "로그인",
	"notices.mcpCopyLink": "링크 복사",
	"notices.mcpMoreWaiting": "이후 대기 중 {count}개: {names}",
	"notices.noActiveNoteToGrab": "[Agent Console] 가져올 활성 노트가 없습니다",
	"notices.removedFromContext":
		'[Agent Console] "{name}"을(를) 컨텍스트에서 제거했습니다',
	"notices.contextFull":
		"[Agent Console] 컨텍스트가 가득 찼습니다 (노트 {max}개) — 하나를 제거한 뒤 추가하세요",
	"notices.addedToContext":
		'[Agent Console] "{name}"을(를) 컨텍스트에 추가했습니다',
	"notices.viewRegistrationConflict":
		"다른 플러그인이 같은 뷰를 사용하고 있어 Agent Console 패널을 열 수 없습니다. 두 플러그인 중 하나를 비활성화하고 Obsidian을 다시 시작하세요.",
	"notices.partialLoad":
		"Agent Console을 불러왔지만 다음 부분을 사용할 수 없습니다: {parts}. Obsidian을 다시 시작해 보세요. 계속 발생하면 다른 플러그인과 충돌일 수 있습니다.",
	"notices.cantSendNow":
		"지금은 보낼 수 없습니다 — 에이전트가 대기 상태일 때 다시 시도하세요.",
	"notices.unknownError": "알 수 없는 오류",
	// --- Phase 2: modals ---
	"modals.common.cancel": "취소",
	"modals.common.close": "닫기",
	"modals.renamePrompt.title": "빠른 프롬프트 이름 바꾸기",
	"modals.renamePrompt.confirm": "이름 바꾸기",
	"modals.agentPicker.placeholder": "새 채팅에 사용할 에이전트를 선택하세요",
	"modals.confirmClose.title": "Agent Console을 닫을까요?",
	"modals.confirmClose.body":
		"열린 채팅이 {count}개 있습니다. 이 패널을 닫으면 모두 닫힙니다.",
	"modals.confirmClose.hint": "닫은 채팅은 세션 기록에서 다시 열 수 있습니다.",
	"modals.confirmClose.confirm": "패널 닫기",
	"modals.quickPromptFolder.title": "빠른 프롬프트를 어디에 저장할까요?",
	"modals.quickPromptFolder.body":
		"빠른 프롬프트 노트를 저장할 폴더를 선택하세요. 여기에 저장되므로 나중에 찾아서 수정할 수 있고, 설정에서 언제든지 바꿀 수 있습니다.",
	"modals.quickPromptFolder.confirm": "이 폴더 사용",
	"modals.importSettings.title": "설정 가져오기",
	"modals.importSettings.searching": "가져올 수 있는 설정을 찾는 중…",
	"modals.importSettings.noneFound":
		"지원되는 플러그인에서 가져올 수 있는 설정을 찾지 못했습니다.",
	"modals.importSettings.found":
		"{source}을(를) 찾았습니다. 에이전트 구성을 Agent Console로 가져올까요?",
	"modals.importSettings.defaultCommand": "(기본 명령)",
	"modals.importSettings.keyPorted": "키 이전됨",
	"modals.importSettings.keyMigrated": "키 마이그레이션됨",
	"modals.importSettings.needsRelink": "다시 연결 필요",
	"modals.importSettings.defaultAgentWithCustom":
		"기본 에이전트: {agent} · 사용자 지정 에이전트 {count}개",
	"modals.importSettings.defaultAgent": "기본 에이전트: {agent}",
	"modals.importSettings.relinkWarning":
		"API 키 {count}개는 자동으로 이전할 수 없습니다 — 가져온 뒤 설정에서 다시 연결하세요.",
	"modals.importSettings.confirm": "가져오기",
	"modals.mcpAuth.placeholder": "MCP 서버 다시 인증…",
	"modals.mcpAuth.instructionOpen": "로그인 페이지 열기",
	"modals.mcpAuth.instructionCopy": "링크 복사",
	"modals.mcpAuth.instructionDismiss": "닫기",
	"modals.mcpAuth.needsSignIn": "{server} – 로그인 필요",
	"modals.mcpAuth.opensWaiting": "{host} 열기 · {when}부터 대기 중",
	"modals.mcpAuth.waitingSince": "{when}부터 대기 중",
	"modals.mcpAuth.emptyTitle": "대기 중인 로그인 요청이 없습니다",
	"modals.mcpAuth.emptyBody":
		"MCP 서버는 에이전트가 시작될 때만 로그인을 요청합니다. 세션을 다시 시작하여 확인하세요 – 서버의 로그인이 만료되었다면 새 요청이 나타납니다.",
	"modals.mcpAuth.emptyWarning":
		"다시 시작하면 이 탭에서 에이전트가 하고 있는 작업이 중단됩니다.",
	"modals.mcpAuth.restartSession": "세션 다시 시작",
	"modals.changeDirectory.title": "디렉터리에서 새 채팅",
	"modals.changeDirectory.body":
		"지정한 디렉터리에서 에이전트가 작업하는 새 채팅 세션을 시작합니다.",
	"modals.changeDirectory.browse": "찾아보기...",
	"modals.changeDirectory.start": "시작",
	"modals.corruptionRecovery.title": "탭 상태 손상",
	"modals.corruptionRecovery.body":
		"저장된 탭 상태를 복원할 수 없습니다. 직접 확인할 수 있도록 원본 데이터를 아래에 표시합니다.",
	"modals.corruptionRecovery.retry": "복원 다시 시도",
	"modals.corruptionRecovery.discard": "저장된 상태 버리기",
	"modals.confirmReset.title": "Obsidian 시스템 프롬프트를 초기화할까요?",
	"modals.confirmReset.body":
		"모든 스위치가 다시 켜지고, 볼트 컨텍스트와 직접 수정한 프롬프트가 지워집니다.",
	"modals.confirmReset.warning": "되돌릴 수 없습니다.",
	"modals.confirmReset.confirm": "기본값으로 초기화",
	"modals.sessionIntent.agentFallback": "새 에이전트",
	"modals.sessionIntent.switchTitle": "{agent}(으)로 전환할까요?",
	"modals.sessionIntent.switchBody":
		"{agent}(으)로 전환하면 새 채팅이 시작됩니다. 지금까지의 메시지를 {agent}에 전달해 맥락을 이어가지만, 이전 에이전트의 도구나 작업 기억은 전달되지 않습니다.\n\n현재 대화는 기록에 저장됩니다.",
	"modals.sessionIntent.switchConfirm": "메시지와 함께 전환",
	"modals.sessionIntent.newChatTitle": "새 채팅을 시작할까요?",
	"modals.sessionIntent.newChatBody": "현재 대화는 기록에 저장됩니다.",
	"modals.sessionIntent.newChatConfirm": "새 채팅",
	"modals.sessionIntent.reloadTitle": "{agent}을(를) 다시 시작할까요?",
	"modals.sessionIntent.reloadBody":
		"대화를 새로 시작합니다. 현재 대화는 기록에 저장됩니다.",
	"modals.sessionIntent.reloadConfirm": "다시 시작",
	"modals.deleteSession.title": "세션을 삭제할까요?",
	"modals.deleteSession.body": '"{title}"을(를) 삭제하시겠습니까?',
	"modals.deleteSession.hint":
		"이 플러그인에서만 세션이 제거됩니다. 세션 데이터는 에이전트 쪽에 남아 있습니다.",
	"modals.deleteSession.confirm": "삭제",
	"modals.editTitle.title": "세션 제목 수정",
	"modals.editTitle.save": "저장",
	"modals.sessionHistory.title": "세션 기록",
});
