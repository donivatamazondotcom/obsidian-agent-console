/**
 * Japanese (日本語) string catalog — settings surface.
 *
 * Factory-wrapped: instantiated only when Japanese is the active locale.
 * Partial against the English contract; missing keys fall back to English.
 * Keys holding literal values (example commands, folder names, KEY=VALUE
 * samples) are intentionally omitted — the English/literal value is
 * correct for every locale.
 *
 * Machine-translated; no native-speaker review yet. Corrections welcome —
 * see CONTRIBUTING.md for the translation-fix PR path.
 */
import type { en } from "./en";

export const ja = (): Partial<Record<keyof typeof en, string>> => ({
	"settings.heading.agents": "エージェント",
	"settings.defaultWorkingDirectory.name": "デフォルトの作業ディレクトリ",
	"settings.defaultWorkingDirectory.placeholder":
		"空欄の場合は保管庫のルートを使用します",
	"settings.defaultWorkingDirectory.button": "参照…",
	"settings.defaultWorkingDirectory.tooltip": "フォルダを選択",
	"settings.heading.builtInAgents": "組み込みエージェント",
	"settings.heading.customAgents": "カスタムエージェント",
	"settings.heading.chatBehavior": "チャットの動作",
	"settings.activeNoteAsDefault.name":
		"アクティブなノートをデフォルトのコンテキストにする",
	"settings.sessionTitle.name": "セッションタイトル",
	"settings.quickPromptsFolder.name": "クイックプロンプトのフォルダ",
	"settings.sendMessageShortcut.name": "メッセージ送信のショートカット",
	"settings.yourVaultContext.name": "保管庫のコンテキスト",
	"settings.editTheFullPrompt.name": "プロンプト全体を編集",
	"settings.editTheFullPrompt.button": "プロンプト全体を編集…",
	"settings.fullPrompt.name": "プロンプト全体",
	"settings.backToOptions.name": "オプションに戻る",
	"settings.backToOptions.button": "オプションに戻る",
	"settings.whatGetsSent.name": "送信される内容",
	"settings.resetToDefaults.name": "デフォルトにリセット",
	"settings.resetToDefaults.button": "デフォルトにリセット",
	"settings.heading.appearanceNotifications": "外観と通知",
	"settings.sidebarSide.name": "サイドバーの位置",
	"settings.sidebarSide.desc":
		"新しいチャットビューを開くサイドバーを選択します",
	"settings.chatFontSize.name": "チャットのフォントサイズ",
	"settings.showEmojis.name": "絵文字を表示",
	"settings.systemNotifications.name": "システム通知",
	"settings.heading.tabs": "タブ",
	"settings.restoreTabsOnStartup.name": "起動時にタブを復元",
	"settings.confirmBeforeClosingMultiple.name":
		"複数のチャットを閉じる前に確認",
	"settings.heading.permissions": "権限",
	"settings.autoAllowPermissions.name": "権限を自動許可",
	"settings.exportFolder.name": "エクスポート先フォルダ",
	"settings.exportFolder.desc":
		"チャットのエクスポートファイルを保存するフォルダ",
	"settings.filename.name": "ファイル名",
	"settings.frontmatterTag.name": "フロントマターのタグ",
	"settings.includeImages.name": "画像を含める",
	"settings.includeImages.desc":
		"エクスポートした Markdown ファイルに画像を含めます",
	"settings.imageLocation.name": "画像の保存先",
	"settings.imageLocation.desc": "エクスポートした画像の保存先",
	"settings.customImageFolder.name": "カスタム画像フォルダ",
	"settings.autoExportOnNew.name": "新規チャット時に自動エクスポート",
	"settings.autoExportOnClose.name": "チャットを閉じるときに自動エクスポート",
	"settings.openNoteAfterExport.name": "エクスポート後にノートを開く",
	"settings.openNoteAfterExport.desc":
		"エクスポートが完了したら、そのノートを自動的に開きます",
	"settings.nodeJsPath.name": "Node.js のパス",
	"settings.heading.windowsSubsystemForLinux":
		"Windows Subsystem for Linux",
	"settings.enableWslMode.name": "WSL モードを有効にする",
	"settings.wslDistribution.name": "WSL ディストリビューション",
	"settings.wslDistribution.placeholder":
		"空欄の場合はデフォルトを使用します",
	"settings.debugMode.name": "デバッグモード",
	"settings.defaultAgent.name": "デフォルトのエージェント",
	"settings.defaultAgent.desc":
		"新しいチャットビューを開くときに使うエージェントを選択します。",
	"settings.apiKey.name": "API キー",
	"settings.path.name": "パス",
	"settings.arguments.name": "引数",
	"settings.environmentVariables.name": "環境変数",
	"settings.authentication.name": "認証",
	"settings.path.name2": "パス",
	"settings.arguments.name2": "引数",
	"settings.environmentVariables.name2": "環境変数",
	"settings.setup.name": "セットアップ",
	"settings.path.name3": "パス",
	"settings.arguments.name3": "引数",
	"settings.environmentVariables.name3": "環境変数",
	"settings.apiKey.name2": "API キー",
	"settings.path.name4": "パス",
	"settings.arguments.name4": "引数",
	"settings.environmentVariables.name4": "環境変数",
	"settings.apiKey.name3": "API キー",
	"settings.path.name5": "パス",
	"settings.arguments.name5": "引数",
	"settings.environmentVariables.name5": "環境変数",
	"settings.environmentVariables.button": "カスタムエージェントを追加",
	"settings.agentId.name": "エージェント ID",
	"settings.agentId.desc": "このエージェントを参照するための一意の識別子です。",
	"settings.agentId.tooltip": "このエージェントを削除",
	"settings.displayName.name": "表示名",
	"settings.displayName.desc": "メニューとヘッダーに表示されます。",
	"settings.path.name6": "パス",
	"settings.path.placeholder6": "コマンド名またはパス",
	"settings.arguments.name6": "引数",
	"settings.environmentVariables.name6": "環境変数",
	"settings.environmentVariables.button2": "コピー",
	"settings.environmentVariables.button3": "コピーしました！",
	"settings.environmentVariables.button4": "コピー",
	"settings.environmentVariables.button5": "自動検出",
	"settings.environmentVariables.button6": "検出中…",
	"settings.environmentVariables.button7": "見つかりません",
	"settings.environmentVariables.button8": "自動検出",
	"settings.environmentVariables.button9": "エラー",
	"settings.environmentVariables.button10": "自動検出",
	"settings.importSettingsFromAnother.name":
		"他のプラグインから設定をインポート",
	"settings.importSettingsFromAnother.button": "インポート…",
	"settings.workingDirectory.name": "作業ディレクトリ",
	"settings.workingDirectory.placeholder":
		"空欄の場合はグローバルのデフォルトを使用します",
	"settings.workingDirectory.button": "参照…",
	"settings.workingDirectory.tooltip": "フォルダを選択",
	"settings.activeNoteAsDefault.desc":
		"新しいチャットのコンテキストストリップに、アクティブなノートを自動的に追加します。つかむボタンでいつでも手動でノートを固定できます。",
	"settings.sessionTitle.desc":
		"新しいチャットのタブ名の付け方です。「エージェントの提案」は最初の返信でエージェントに短いタイトルを求め、届くまでは最初のメッセージを仮のタイトルにします。タブ名はいつでも手動で変更できます。",
	"settings.quickPromptsFolder.desc":
		"クイックプロンプトを探す保管庫のフォルダです。プロンプト 1 つにつき Markdown ノートを 1 つ使います。ノートの説明（または名前/タイトル/ファイル名）がラベルになり、本文がプロンプトの内容になります。変更はすぐに反映されます。",
	"settings.sendMessageShortcut.desc":
		"メッセージを送信するキーボードショートカットを選択します。注意：Cmd/Ctrl+Enter を使う場合、そのキーに割り当てられている他のホットキーを解除する必要があるかもしれません（設定 → ホットキー）。",
	"settings.sendMessageShortcut.desc2":
		"各チャットの最初のメッセージと一緒にエージェントへ送信され、Obsidian の中で自然に動作するのを助けます。ほとんどの場合、そのままで問題ありません。",
	"settings.yourVaultContext.desc":
		"エージェントに伝える自分用のメモです。ファイルの置き場所、命名やリンクの決まり、好みの口調などを書きます。プロンプトの末尾に追加され、この保管庫のすべてのチャットで同じ内容になります。",
	"settings.editTheFullPrompt.desc":
		"上級者向け：プロンプト全体を手動で編集します。下に表示されているテキストがあらかじめ入力された状態で開きます。",
	"settings.fullPrompt.desc":
		"プロンプト全体を手動で編集しています。スイッチの設定はこのテキストに組み込まれており、個別には適用されません。下のプレビューが実際に送信される内容そのものです。",
	"settings.backToOptions.desc":
		"スイッチの設定に戻ります。手動で編集したテキストは、戻ってきたときのために保存されます。",
	"settings.whatGetsSent.desc":
		"最初のメッセージでエージェントが受け取るテキストをそのまま表示する読み取り専用プレビューです。",
	"settings.whatGetsSent.desc2":
		"ノートに関する行は、チャットのフォルダが保管庫の中にあるときだけ送信されます。",
	"settings.resetToDefaults.desc":
		"すべてのスイッチをオンにし、保管庫のコンテキストと手動編集したプロンプトを消去して、オプション表示に戻ります。",
	"settings.showEmojis.desc":
		"ツール呼び出し、思考、プラン、ターミナルブロックに絵文字アイコンを表示します。",
	"settings.systemNotifications.desc":
		"エージェントが返信を終えたとき、または権限を求めたときに通知を表示します。完了通知にはタブ名が表示され、クリックするとそのタブに切り替わります。Obsidian にフォーカスがある間は通知されません。",
	"settings.restoreTabsOnStartup.desc":
		"Obsidian の終了時に開いているタブを保存し、次回起動時に復元します。各ビューは自分のタブを独立して復元します。",
	"settings.confirmBeforeClosingMultiple.desc":
		"開いているチャットが 2 つ以上あるとき、Cmd+W でパネルを閉じる前に警告し、実行中の複数のエージェントを一度に失わないようにします。",
	"settings.autoAllowPermissions.desc":
		"エージェントからのすべての権限リクエストを自動的に許可します。⚠️ 取り扱い注意——エージェントにシステムへのフルアクセスを与えます。",
	"settings.filename.desc":
		"エクスポートするファイル名のテンプレートです。日付は {date}、時刻は {time} を使います",
	"settings.frontmatterTag.desc":
		"エクスポートしたノートに追加するタグです。ネストしたタグに対応しています（例：projects/agent-console）。空欄にすると無効になります。",
	"settings.customImageFolder.desc":
		"エクスポートした画像のフォルダパスです（保管庫のルートからの相対パス）",
	"settings.autoExportOnNew.desc":
		"新しいチャットを始めるときに、現在のチャットを自動的にエクスポートします",
	"settings.autoExportOnClose.desc":
		"チャットビューを閉じるときに、現在のチャットを自動的にエクスポートします",
	"settings.nodeJsPath.desc":
		"Node.js のパスです。通常は空欄のままにします。node が標準以外の場所にあるときだけ必要です（絶対パスを入力、例：/usr/local/bin/node）。",
	"settings.nodeJsPath.placeholder":
		"空欄のまま（ログインシェルが自動解決します）",
	"settings.enableWslMode.desc":
		"エージェントを Windows Subsystem for Linux の中で実行します。Codex のようにネイティブ Windows 環境でうまく動かないエージェントに推奨します。",
	"settings.wslDistribution.desc":
		"WSL ディストリビューション名を指定します（空欄の場合はデフォルト）。例：Ubuntu、Debian",
	"settings.debugMode.desc":
		"コンソールにデバッグログを出力します。開発やトラブルシューティングに役立ちます。",
	"settings.apiKey.desc":
		"Gemini API キーです。Google アカウントでログインしない場合に必要です。Obsidian のキーチェーンから選ぶか、新しいシークレットを作成してください。",
	"settings.environmentVariables.desc":
		"KEY=VALUE のペアを 1 行に 1 つずつ入力してください。Vertex AI の認証に必要です。GEMINI_API_KEY は上のフィールドから自動的に取得されます。",
	"settings.authentication.desc":
		"KEY=VALUE のペアを 1 行に 1 つずつ入力してください。特に必要がなければ空欄のままにしてください。",
	"settings.setup.desc":
		"KEY=VALUE のペアを 1 行に 1 つずつ入力してください。OpenCode のプロセスにのみ適用され、モデルのバックエンドには適用されません。たとえばローカルモデルのコンテキスト長は、ここではなく ollama サーバー側で設定します（OLLAMA_CONTEXT_LENGTH）。特に必要がなければ空欄のままにしてください。",
	"settings.setup.desc2":
		"Anthropic API キーです。Anthropic アカウントでログインしない場合に必要です。Obsidian のキーチェーンから選ぶか、新しいシークレットを作成してください。",
	"settings.setup.desc3":
		"引数はスペースまたは改行で区切って入力してください。スペースを含む引数は引用符で囲んでください。空欄の場合は引数なしで実行します。",
	"settings.setup.desc4":
		"KEY=VALUE のペアを 1 行に 1 つずつ入力してください。ANTHROPIC_API_KEY は上のフィールドから自動的に取得されます。",
	"settings.setup.desc5":
		"OpenAI API キーです。OpenAI アカウントでログインしない場合に必要です。Obsidian のキーチェーンから選ぶか、新しいシークレットを作成してください。",
	"settings.setup.desc6":
		"引数はスペースまたは改行で区切って入力してください。スペースを含む引数は引用符で囲んでください。空欄の場合は引数なしで実行します。",
	"settings.setup.desc7":
		"KEY=VALUE のペアを 1 行に 1 つずつ入力してください。OPENAI_API_KEY は上のフィールドから自動的に取得されます。",
	"settings.displayName.desc2":
		"カスタムエージェントのコマンド名またはパスです。コマンド名だけを入力するとログインシェルが解決します。絶対パスも入力できます。",
	"settings.displayName.desc3":
		"引数はスペースまたは改行で区切って入力してください。スペースを含む引数は引用符で囲んでください。空欄の場合は引数なしで実行します。",
	"settings.displayName.desc4":
		"KEY=VALUE のペアを 1 行に 1 つずつ入力してください。（プレーンテキストとして保存されます）",
	"settings.importSettingsFromAnother.desc":
		"他のエージェントプラグイン（例：Agent Client）からエージェント定義、デフォルト設定、API キーを取り込みます。適用前にプレビューを表示します。",
	"settings.path.desc":
		"Gemini CLI のコマンド名またはパスです。「gemini」とだけ入力するとログインシェルが解決します。特定のバージョンを使うには絶対パスを入力してください。",
	"settings.arguments.desc":
		"引数はスペースまたは改行で区切って入力してください。スペースを含む引数は引用符で囲んでください。空欄の場合は引数なしで実行します。（現在、Gemini CLI には「--experimental-acp」オプションが必要です。）",
	"settings.authentication.desc2":
		"Kiro CLI はあなたの Kiro アカウントでサインインするため、API キーは不要です。ターミナルで「kiro-cli」を一度実行してサインインしてから、ここで Kiro CLI を選択してください。",
	"settings.path.desc2":
		"kiro-cli のコマンド名またはパスです。「kiro-cli」とだけ入力するとログインシェルが解決します。絶対パスも入力できます（通常は ~/.local/bin/kiro-cli）。",
	"settings.arguments.desc2":
		"引数はスペースまたは改行で区切って入力してください。スペースを含む引数は引用符で囲んでください。Kiro CLI には「acp」サブコマンドが必要です。",
	"settings.setup.desc8":
		"OpenCode はモデルの選択とサインインを自身の設定で管理するため、ここに API キーは不要です。opencode.ai のワンライナーでインストールしてから OpenCode を選択してください。ローカルモデルをオフラインで動かすには、OpenCode 自身の設定で ollama を指定します——OpenCode のセットアップガイドをご覧ください。",
	"settings.path.desc3":
		"opencode のコマンド名またはパスです。「opencode」とだけ入力するとログインシェルが解決します。絶対パスも入力できます（通常は ~/.opencode/bin/opencode）。",
	"settings.arguments.desc3":
		"引数はスペースまたは改行で区切って入力してください。スペースを含む引数は引用符で囲んでください。OpenCode には「acp」サブコマンドが必要です。",
	"settings.path.desc4":
		"claude-agent-acp のコマンド名またはパスです。「claude-agent-acp」とだけ入力するとログインシェルが解決します。絶対パスも入力できます。",
	"settings.path.desc5":
		"codex-acp のコマンド名またはパスです。「codex-acp」とだけ入力するとログインシェルが解決します。絶対パスも入力できます。",
	"settings.fontSize.desc":
		"チャットメッセージ領域のフォントサイズを調整します（{min}〜{max}px）。",
	"settings.autoDetect.tooltip":
		"`{lookupCmd} {commandName}` を実行してパスを探します",
	"notices.agentIdInUse":
		"エージェント ID「{desired}」はすでに使われているため、「{unique}」に変更しました。",
	"settings.docLink.prefix": "困ったときは",
	"settings.docLink.linkText": "ドキュメント",
	"settings.docLink.suffix": "をご覧ください。",
	"settings.customAgents.emptyState":
		"カスタムエージェントはまだ設定されていません。",
	"settings.language.name": "言語",
	"settings.language.desc":
		"このプラグインのボタン、メニュー、メッセージに使う言語です。「自動」は Obsidian の言語設定に従います。",
	"settings.language.optionAuto": "自動（Obsidian に合わせる）",
	"settings.language.reloadNotice":
		"言語は Obsidian の再読み込み後に切り替わります。",
	"settings.section.obsidianSystemPrompt": "Obsidian システムプロンプト",
	"settings.section.export": "エクスポート",
	"settings.section.advanced": "詳細設定",
	"settings.sidebarSide.optionRight": "右サイドバー",
	"settings.sidebarSide.optionLeft": "左サイドバー",
	"settings.sendMessageShortcut.optionEnter":
		"Enter で送信、Shift+Enter で改行",
	"settings.sendMessageShortcut.optionCmdEnter":
		"Cmd/Ctrl+Enter で送信、Enter で改行",
	"settings.imageLocation.optionObsidian": "Obsidian の添付ファイル設定を使用",
	"settings.imageLocation.optionCustom": "カスタムフォルダに保存",
	"settings.imageLocation.optionBase64": "Base64 で埋め込み（非推奨）",
	"settings.sessionTitle.optionAgentSuggested":
		"最初の返信でエージェントが提案",
	"settings.sessionTitle.optionPromptDerived": "最初のメッセージから生成",
	"settings.sessionTitle.optionAgentTimestamp": "エージェント名とタイムスタンプ",
	"settings.obsidianPrompt.hostIdentity.name":
		"Obsidian で動作中だと伝える",
	"settings.obsidianPrompt.hostIdentity.desc":
		"エージェントに、あなたの Obsidian アプリの中で作業していることを知らせます。",
	"settings.obsidianPrompt.rendering.name": "返信の表示方法を説明する",
	"settings.obsidianPrompt.rendering.desc":
		"リンク、数式、図が正しく表示されるように返信の書式をエージェントに伝え、ノートを書くときに従うべき Obsidian の約束事を知らせます。",
	"settings.obsidianPrompt.workingDirectory.name": "作業フォルダを共有する",
	"settings.obsidianPrompt.workingDirectory.desc":
		"このチャットがどのフォルダで作業しているかをエージェントに伝えます。",
	"settings.obsidianPrompt.vaultCollaboration.name":
		"ノートの操作を許可する",
	"settings.obsidianPrompt.vaultCollaboration.desc":
		"エージェントがノートを読み書きできることを伝えます。チャットが保管庫の中で実行されているときだけ送信されます。",
	"settings.obsidianPrompt.interactiveButtons.name":
		"クリックできる選択肢を提示する",
	"settings.obsidianPrompt.interactiveButtons.desc":
		"エージェントが少数の選択肢を示すとき、返信の中にボタンを表示できるようにします。ボタンをクリックすると、選んだ内容が通常のメッセージとして送信されます。",
	"settings.obsidianPrompt.previewEmpty":
		"（システムプロンプトは送信されません——エージェントは Obsidian のコンテキストを受け取りません。）",
	"settings.defaultWorkingDirectory.desc":
		"新しいチャットが開始されるディレクトリです。空欄の場合は保管庫のルートを使用します。既存のチャットと復元されたチャットは、それぞれのディレクトリを維持します。",
	"settings.defaultWorkingDirectory.statusVaultRoot":
		"現在：保管庫のルート{root}。",
	"settings.defaultWorkingDirectory.statusInvalid":
		"⚠「{value}」は有効な絶対ディレクトリではありません——新しいチャットは保管庫のルート{root}を使用します。",
	"settings.defaultWorkingDirectory.statusResolved": "解決先：{dir}。",
	"settings.chatFontSize.placeholderCurrent": "{px}（現在の値）",
	"settings.installHint.prefix":
		"未インストールですか？ターミナルで実行してください：",
	"settings.agentWorkingDirectory.desc":
		"このエージェントの新しいチャットが開始されるフォルダです。空欄の場合はグローバルのデフォルト作業ディレクトリ、次に保管庫のルートを使用します。",
	"settings.agentWorkingDirectory.sourceGlobal": "（グローバルのデフォルト）",
	"settings.agentWorkingDirectory.sourceVaultRoot": "（保管庫のルート）",
	"settings.agentWorkingDirectory.statusCurrent": "現在：{dir}{label}。",
	"settings.agentWorkingDirectory.statusInvalid":
		"⚠「{value}」は有効な絶対ディレクトリではありません——{dir} を使用します。",
	"settings.agentWorkingDirectory.statusResolved": "解決先：{dir}。",
	"settings.defaultWorkingDirectory.pickerTitle":
		"デフォルトの作業ディレクトリを選択",
	"settings.workingDirectory.pickerTitle": "作業ディレクトリを選択",
	"settings.customAgents.defaultName": "カスタムエージェント",
});
