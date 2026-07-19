/**
 * Japanese (日本語) string catalog — settings, notices, and modals (phases 1–3).
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
	"settings.obsidianPrompt.respondInLanguage.name": "自分の言語で返信",
	"settings.obsidianPrompt.respondInLanguage.desc":
		"Agent Console が英語以外のとき、エージェントにあなたの言語で返信し、新しいタブもあなたの言語で名付けるよう求めます。別の言語で書いたり切り替えを頼んだりすれば、それに従います。",
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
	// --- Phase 2: notices ---
	"notices.quickPromptCollided":
		"[Agent Console] 同じ名前のクイックプロンプトが既にあるため、「{basename}」として保存しました。",
	"notices.quickPromptCreated":
		"[Agent Console] クイックプロンプト「{basename}」を作成しました。",
	"notices.quickPromptCreateFailed":
		"[Agent Console] クイックプロンプトを作成できませんでした — コンソールを確認してください。",
	"notices.quickPromptNoteNotFound":
		"[Agent Console] 「{label}」を開けませんでした — ノートが見つかりません。",
	"notices.promptTextCopied": "[Agent Console] プロンプトのテキストをコピーしました。",
	"notices.promptTextCopyFailed":
		"[Agent Console] プロンプトのテキストをコピーできませんでした — コンソールを確認してください。",
	"notices.quickPromptRenameFailed":
		"[Agent Console] クイックプロンプトの名前を変更できませんでした — コンソールを確認してください。",
	"notices.noQuickPromptsFound":
		"[Agent Console] クイックプロンプトが見つかりません。「{folder}」フォルダーに Markdown ノートを追加してください。",
	"notices.noChatTabsOpen": "[Agent Console] 開いているチャットタブがありません",
	"notices.noPromptToBroadcast":
		"[Agent Console] ブロードキャストするプロンプトがありません",
	"notices.noOtherTabsToBroadcast":
		"[Agent Console] ブロードキャスト先の他のチャットタブがありません",
	"notices.broadcastSkipNote":
		"（{count} 件スキップ — 送信待ちのメッセージあり）",
	"notices.promptBroadcast":
		"[Agent Console] {count} 個のタブにプロンプトをブロードキャストしました{skipNote}",
	"notices.noTabsReadyToSend": "[Agent Console] 送信できるタブがありません",
	"notices.sentInTabs":
		"[Agent Console] {count} 個のタブで送信しました{skipNote}",
	"notices.cancelBroadcast":
		"[Agent Console] {count} 個のタブにキャンセルをブロードキャストしました",
	"notices.contextStripMigration":
		"Agent Console: アクティブなノートはチャットに追従しなくなりました。新しいコンテキストストリップでノートをコンテキストに固定してください。",
	"notices.importSettingsFound":
		"Agent Console: {plugin} の設定が見つかりました — クリックしてインポートします。",
	"notices.apiKeyMigrated":
		"[Agent Console] {agent} の API キーを Obsidian のキーチェーンに「{secretId}」として移行しました。",
	"notices.apiKeyMigratedFallback":
		"[Agent Console] 「{defaultId}」は既に使用されていたため、{agent} の API キーを「{fallbackId}」として移行しました。Obsidian のキーチェーン設定で名前を変更できます。",
	"notices.updateAvailable": "[Agent Console] アップデートがあります: v{version}",
	"notices.chatExported": "[Agent Console] チャットを {path} に書き出しました",
	"notices.chatExportFailed": "[Agent Console] チャットの書き出しに失敗しました",
	"notices.alreadyNewSession": "[Agent Console] 既に新しいセッションです",
	"notices.newSessionFailed":
		"[Agent Console] 新しいセッションを作成できませんでした",
	"notices.noMessagesToExport": "[Agent Console] 書き出すメッセージがありません",
	"notices.sessionRestartedFresh":
		"[Agent Console] セッションを最初からやり直しました",
	"notices.sessionReloading": "[Agent Console] セッションを再読み込み中…",
	"notices.sessionReloaded": "[Agent Console] セッションを再読み込みしました",
	"notices.sessionReloadedFresh":
		"[Agent Console] このエージェントは再開に対応していないため、新しいセッションとして再読み込みしました（表示中の履歴はローカルのものです）",
	"notices.sessionReloadFailed":
		"[Agent Console] セッションの再読み込みに失敗しました",
	"notices.invalidWorkingDirectory":
		"Agent Console: 設定された作業ディレクトリが有効な絶対パスではありません。新しいチャットを {dir} で開始しました。",
	"notices.newChatStartedIn":
		"Agent Console: 新しいチャットを {dir} で開始しました",
	"notices.contextNoteDeleted":
		"[Agent Console] コンテキストノート「{name}」が削除されたため、チャットのコンテキストから取り除きました。",
	"notices.noActivePermissionRequest":
		"[Agent Console] 処理待ちの権限リクエストはありません",
	"notices.maxAttachments": "[Agent Console] 添付できるのは最大 {count} 件です",
	"notices.imageTooLarge":
		"[Agent Console] 画像が大きすぎます（最大 {size}MB）",
	"notices.imageAttachFailed": "[Agent Console] 画像を添付できませんでした",
	"notices.filePathUndetermined":
		"[Agent Console] ファイルパスを特定できませんでした",
	"notices.imagePasteConnecting":
		"[Agent Console] エージェントに接続中です – 少し待ってから画像を貼り付け直してください。",
	"notices.imagePasteUnsupported":
		"[Agent Console] このエージェントは画像の貼り付けに対応していません。ドラッグ＆ドロップをお試しください。",
	"notices.tabRestoreCorrupted":
		"以前のタブを復元できませんでした — 保存された状態が壊れています。",
	"notices.viewDetails": "詳細を表示",
	"notices.noRecentlyClosedSession": "再び開ける最近閉じたセッションがありません",
	"notices.duplicateTabName": "[Agent Console] 同じ名前のタブが既にあります",
	"notices.sessionRestoreFailed": "[Agent Console] セッションを復元できませんでした",
	"notices.sessionForkFailed": "[Agent Console] セッションを分岐できませんでした",
	"notices.sessionDeleted": "[Agent Console] セッションを削除しました",
	"notices.sessionDeleteFailed": "[Agent Console] セッションを削除できませんでした",
	"notices.titleUpdated": "[Agent Console] タイトルを更新しました",
	"notices.titleUpdateFailed": "[Agent Console] タイトルを更新できませんでした",
	"notices.titleEmpty": "タイトルは空にできません",
	"notices.settingsImported":
		"Agent Console: {source} から設定をインポートしました。{relinkMsg}",
	"notices.settingsImportedRelink":
		" 設定で {count} 件の API キーを再リンクしてください。",
	"notices.settingsImportFailed":
		"Agent Console: インポートに失敗しました。{error}",
	"notices.mcpSignInLinkCopied": "「{server}」のサインインリンクをコピーしました",
	"notices.mcpNeedsSignInTitle":
		"MCP サーバー「{server}」はサインインが必要です",
	"notices.mcpOpensHost": "{host} を開きます",
	"notices.mcpSignIn": "サインイン",
	"notices.mcpCopyLink": "リンクをコピー",
	"notices.mcpMoreWaiting": "この後 {count} 件が待機中: {names}",
	"notices.noActiveNoteToGrab":
		"[Agent Console] 取り込めるアクティブなノートがありません",
	"notices.removedFromContext":
		"[Agent Console] 「{name}」をコンテキストから取り除きました",
	"notices.contextFull":
		"[Agent Console] コンテキストが上限です（ノート {max} 件）— 1 件取り除いてから追加してください",
	"notices.addedToContext":
		"[Agent Console] 「{name}」をコンテキストに追加しました",
	"notices.viewRegistrationConflict":
		"別のプラグインが同じビューを使用しているため、Agent Console のパネルを開けません。どちらかのプラグインを無効にして Obsidian を再読み込みしてください。",
	"notices.partialLoad":
		"Agent Console は読み込まれましたが、次の部分が利用できません: {parts}。Obsidian を再読み込みしてください。繰り返す場合は、他のプラグインと競合している可能性があります。",
	"notices.cantSendNow":
		"今は送信できません — エージェントが待機中になってからお試しください。",
	"notices.unknownError": "不明なエラー",
	// --- Phase 2: modals ---
	"modals.common.cancel": "キャンセル",
	"modals.common.close": "閉じる",
	"modals.renamePrompt.title": "クイックプロンプトの名前を変更",
	"modals.renamePrompt.confirm": "名前を変更",
	"modals.agentPicker.placeholder": "新しいチャットで使うエージェントを選択",
	"modals.confirmClose.title": "Agent Console を閉じますか？",
	"modals.confirmClose.body":
		"{count} 件のチャットが開いています。このパネルを閉じるとすべて閉じられます。",
	"modals.confirmClose.hint":
		"閉じたチャットはセッション履歴から再び開けます。",
	"modals.confirmClose.confirm": "パネルを閉じる",
	"modals.quickPromptFolder.title": "クイックプロンプトの保存先は？",
	"modals.quickPromptFolder.body":
		"クイックプロンプトのノートを保存するフォルダーを選んでください。ここに保存されるので、後から探して編集できます — 設定でいつでも変更できます。",
	"modals.quickPromptFolder.confirm": "このフォルダーを使う",
	"modals.importSettings.title": "設定をインポート",
	"modals.importSettings.searching": "インポートできる設定を探しています…",
	"modals.importSettings.noneFound":
		"対応プラグインからインポートできる設定が見つかりませんでした。",
	"modals.importSettings.found":
		"{source} が見つかりました。そのエージェント構成を Agent Console にインポートしますか？",
	"modals.importSettings.defaultCommand": "（既定のコマンド）",
	"modals.importSettings.keyPorted": "キー移行済み",
	"modals.importSettings.keyMigrated": "キー移動済み",
	"modals.importSettings.needsRelink": "再リンクが必要",
	"modals.importSettings.defaultAgentWithCustom":
		"既定のエージェント: {agent} · カスタムエージェント {count} 件",
	"modals.importSettings.defaultAgent": "既定のエージェント: {agent}",
	"modals.importSettings.relinkWarning":
		"{count} 件の API キーは自動では移行できません — インポート後に設定で再リンクしてください。",
	"modals.importSettings.confirm": "インポート",
	"modals.mcpAuth.placeholder": "MCP サーバーを再認証…",
	"modals.mcpAuth.instructionOpen": "サインインページを開く",
	"modals.mcpAuth.instructionCopy": "リンクをコピー",
	"modals.mcpAuth.instructionDismiss": "閉じる",
	"modals.mcpAuth.needsSignIn": "{server} – サインインが必要",
	"modals.mcpAuth.opensWaiting": "{host} を開きます · {when} から待機中",
	"modals.mcpAuth.waitingSince": "{when} から待機中",
	"modals.mcpAuth.emptyTitle": "待機中のサインインリクエストはありません",
	"modals.mcpAuth.emptyBody":
		"MCP サーバーがサインインを求めるのはエージェントの起動中だけです。セッションを再起動して再確認してください – サーバーのサインインが期限切れの場合、新しいリクエストが表示されます。",
	"modals.mcpAuth.emptyWarning":
		"再起動すると、このタブでエージェントが実行中の処理は中断されます。",
	"modals.mcpAuth.restartSession": "セッションを再起動",
	"modals.changeDirectory.title": "ディレクトリで新しいチャット",
	"modals.changeDirectory.body":
		"指定したディレクトリでエージェントが作業する新しいチャットセッションを開始します。",
	"modals.changeDirectory.browse": "参照...",
	"modals.changeDirectory.start": "開始",
	"modals.corruptionRecovery.title": "タブ状態の破損",
	"modals.corruptionRecovery.body":
		"保存されたタブの状態を復元できませんでした。手動で確認できるよう、元のデータを以下に表示します。",
	"modals.corruptionRecovery.retry": "復元を再試行",
	"modals.corruptionRecovery.discard": "保存された状態を破棄",
	"modals.confirmReset.title": "Obsidian システムプロンプトをリセットしますか？",
	"modals.confirmReset.body":
		"すべてのスイッチがオンに戻り、ボールトのコンテキストと手動で編集したプロンプトが消去されます。",
	"modals.confirmReset.warning": "この操作は取り消せません。",
	"modals.confirmReset.confirm": "既定値にリセット",
	"modals.sessionIntent.agentFallback": "新しいエージェント",
	"modals.sessionIntent.switchTitle": "{agent} に切り替えますか？",
	"modals.sessionIntent.switchBody":
		"{agent} に切り替えると新しいチャットが始まります。これまでのメッセージを {agent} に渡して文脈を引き継ぎますが、前のエージェントのツールや作業記憶は引き継がれません。\n\n現在の会話は履歴に保存されます。",
	"modals.sessionIntent.switchConfirm": "メッセージを引き継いで切り替え",
	"modals.sessionIntent.newChatTitle": "新しいチャットを始めますか？",
	"modals.sessionIntent.newChatBody": "現在の会話は履歴に保存されます。",
	"modals.sessionIntent.newChatConfirm": "新しいチャット",
	"modals.sessionIntent.reloadTitle": "{agent} を再読み込みしますか？",
	"modals.sessionIntent.reloadBody":
		"会話を最初からやり直します。現在の会話は履歴に保存されます。",
	"modals.sessionIntent.reloadConfirm": "再読み込み",
	"modals.deleteSession.title": "セッションを削除しますか？",
	"modals.deleteSession.body": "「{title}」を削除してもよろしいですか？",
	"modals.deleteSession.hint":
		"このプラグインからセッションが取り除かれるだけです。セッションのデータはエージェント側に残ります。",
	"modals.deleteSession.confirm": "削除",
	"modals.editTitle.title": "セッションタイトルを編集",
	"modals.editTitle.save": "保存",
	"modals.sessionHistory.title": "セッション履歴",

	// ---- Phase 3: commands ----
	"commands.openChat": "チャットを開く",
	"commands.focusNextView": "次のチャットビューへ移動",
	"commands.focusPreviousView": "前のチャットビューへ移動",
	"commands.closeSessionTab": "セッションタブを閉じる",
	"commands.nextSessionTab": "次のセッションタブ",
	"commands.previousSessionTab": "前のセッションタブ",
	"commands.showTabList": "タブ一覧を表示",
	"commands.reopenClosedTab": "閉じたセッションタブを再度開く",
	"commands.openSessionHistory": "セッション履歴を開く",
	"commands.openNewView": "新しいビューを開く",
	"commands.importSettings": "他のエージェントプラグインから設定をインポート",
	"commands.quickPromptsSearch": "クイックプロンプト: 検索",
	"commands.quickPromptsNew": "クイックプロンプト: 新規プロンプト",
	"commands.quickPromptsSaveComposer":
		"クイックプロンプト: 入力欄の内容をプロンプトとして保存",
	"commands.newChatWithAgent": "エージェントを選んで新しいチャット…",
	"commands.approvePermission": "保留中の権限を承認",
	"commands.rejectPermission": "保留中の権限を拒否",
	"commands.toggleActiveNote": "アクティブノートをコンテキストに追加/削除",
	"commands.newChat": "新しいチャット",
	"commands.cancelMessage": "現在のメッセージをキャンセル",
	"commands.exportChat": "チャットをエクスポート",
	"commands.reloadSession": "セッションを再読み込み",
	"commands.restartSessionFresh": "セッションを最初からやり直す",
	"commands.reauthMcp": "MCP サーバーを再認証",
	"commands.broadcastPrompt": "プロンプトを一斉送信",
	"commands.broadcastSend": "全タブで送信",
	"commands.broadcastCancel": "全タブでキャンセル",
	// ---- Phase 3: chat header ----
	"chat.header.connecting": "接続中…",
	"chat.header.notConnected": "未接続",
	"chat.header.updatePill": "プラグインの更新があります！",
	"chat.header.updateTooltip":
		"コミュニティプラグインを開いて Agent Console を更新",
	"chat.header.reloadTooltip":
		"再読み込み — セッションを再開し会話を保持します。Shift クリック: 最初からやり直し — 新しいセッションで会話をクリアします。",
	"chat.header.sessionHistory": "セッション履歴",
	"chat.header.exportTooltip": "チャットを Markdown にエクスポート",
	"chat.header.more": "その他",
	"chat.header.tooltipPlugin": "プラグイン: {value}",
	"chat.header.tooltipProfile": "プロファイル: {value}",
	"chat.header.tooltipRuntime": "ランタイム: {value}",
	"chat.header.tooltipModel": "モデル: {value}",
	// ---- Phase 3: more-menu + tab bar ----
	"chat.menu.switchAgent": "エージェントを切り替え",
	"chat.menu.openNewView": "新しいビューを開く",
	"chat.menu.newChatInDirectory": "ディレクトリで新しいチャット...",
	"chat.menu.pluginSettings": "プラグイン設定",
	"chat.tabBar.rename": "名前を変更",
	"chat.tabBar.close": "閉じる",
	"chat.tabBar.closeOthers": "他のタブを閉じる",
	"chat.tabBar.closeToRight": "右側のタブを閉じる",
	"chat.tabBar.closeTab": "タブを閉じる",
	"chat.tabBar.newSessionTab": "新しいセッションタブ",
	"chat.tabBar.tabList": "タブ一覧",
	// ---- Phase 3: tab labels ----
	"chat.tabs.forkPrefix": "フォーク: {label}",
	"chat.tabs.sessionFallback": "セッション",
	"chat.tabs.chatFallback": "チャット",
	"chat.tabs.defaultAgentSuffix": "{name}（デフォルト）",
	// ---- Phase 3: composer + toolbar ----
	"chat.composer.queuedLocked":
		"待機中のメッセージ（ロック中）— 変更するには「編集」を使ってください",
	"chat.composer.edit": "編集",
	"chat.composer.delete": "削除",
	"chat.composer.mode": "モード",
	"chat.composer.model": "モデル",
	"chat.composer.selectMode": "モードを選択",
	"chat.composer.selectModel": "モデルを選択",
	"chat.composer.stopGeneration": "生成を停止",
	"chat.composer.sendMessage": "メッセージを送信",
	"chat.composer.sendToConnect": "送信して接続",
	"chat.composer.connecting": "接続中...",
	"chat.composer.usageTokens": "{used} / {size} トークン",
	"chat.composer.placeholder":
		"{agent} にメッセージ - @ でノートを参照{commands}、! でクイックプロンプト",
	"chat.composer.placeholderCommands": "、/ でコマンド",
	"chat.composer.placeholderStreaming":
		"メッセージを待機列へ – Enter を押すと {agent} の完了後に送信されます",
	"chat.composer.placeholderQueueSteer":
		"{queueKey} で待機列へ · {steerKey} で今すぐ送信",
	"chat.composer.queuedBannerReady": "待機中 — {agent} の完了後に送信されます",
	"chat.composer.queuedBannerWaiting": "待機中 — 準備でき次第送信されます",
	// ---- Phase 3: message list + landing ----
	"chat.messages.sending": "送信中…",
	"chat.messages.waitingForPermission": "権限を待っています...",
	"chat.messages.restoringSession": "セッションを復元中...",
	"chat.messages.connectingTo": "{agent} に接続中...",
	"chat.messages.sendToConnectTo":
		"メッセージを送信して {agent} に接続しましょう...",
	"chat.messages.startConversation": "{agent} と会話を始めましょう...",
	"chat.messages.copyMessage": "メッセージをコピー",
	"chat.messages.attachedImage": "添付画像",
	"chat.messages.unsupportedContent": "サポートされていないコンテンツ形式",
	"chat.landing.zeroTab":
		"開いているチャットがありません。下に入力して新しく始めましょう。",
	"chat.landing.newChatWithAgent": "エージェントと新しいチャット",
	"chat.landing.openSessionHistory": "セッション履歴を開く",
	"chat.landing.pickAgent": "エージェントを選んで始めましょう",
	"chat.landing.detected": "このマシンで検出済み:",
	"chat.landing.install": "インストール",
	"chat.landing.installing": "インストール中…",
	"chat.landing.copyCommand": "コマンドをコピー",
	"chat.landing.copied": "コピーしました！",
	"chat.landing.setupGuide": "セットアップガイド",
	"chat.landing.installDidntFinish": "インストールが完了しませんでした。",
	"chat.landing.orSeparator": "、または ",
	"chat.landing.listSeparator": "、",
	"chat.landing.openSettings": "設定を開く",
	"chat.landing.redetect": "再検出",
	"chat.landing.pathHint":
		"別の場所にインストール済みですか？設定でパスを指定してください。",
	"chat.landing.needAgentPrefix":
		"エージェントがまだインストールされていません。Agent Console にはパソコン上の AI エージェントが必要です – ",
	// ---- Phase 3: context strip ----
	"chat.contextStrip.noActiveNote": "ピン留めできるアクティブノートがありません",
	"chat.contextStrip.alreadyInContext": "{name} はすでにコンテキストにあります",
	"chat.contextStrip.maxNotes":
		"コンテキストノートは最大 8 件です。1 件削除してから追加してください。",
	"chat.contextStrip.pin": "ピン留め: {name}",
	"chat.contextStrip.removeNote": "ノートをコンテキストから削除",
	"chat.contextStrip.dontAddActiveNote":
		"このチャットのコンテキストにアクティブノートを追加しない",
	// ---- Phase 3: session history ----
	"chat.history.justNow": "たった今",
	"chat.history.minutesAgo_one": "1 分前",
	"chat.history.minutesAgo_other": "{count} 分前",
	"chat.history.hoursAgo_one": "1 時間前",
	"chat.history.hoursAgo_other": "{count} 時間前",
	"chat.history.daysAgo": "{count} 日前",
	"chat.history.yesterday": "昨日",
	"chat.history.editTitle": "セッションタイトルを編集",
	"chat.history.restoreSession": "セッションを復元",
	"chat.history.forkSession": "セッションを新しいタブにフォーク",
	"chat.history.deleteSession": "セッションを削除",
	"chat.history.restore": "復元",
	"chat.history.retry": "再試行",
	"chat.history.local": "ローカル",
	"chat.history.agentBadge": "エージェント: {label}",
	"chat.history.synced": "{when}に同期",
	"chat.history.notSynced": "まだ同期されていません",
	"chat.history.reconnectRefresh":
		"メッセージを送信して再接続・更新してください",
	"chat.history.sendToConnect": "メッセージを送信して接続してください",
	"chat.history.untitled": "無題のセッション",
	"chat.history.noRestoreSupport":
		"このエージェントはセッションの復元をサポートしていません。",
	"chat.history.sessionSource": "セッションのソース",
	"chat.history.agentSessions": "エージェントサーバーのセッション（{agent}）",
	"chat.history.noServerList":
		"{agent} はサーバー上にセッション一覧を持たないため、ローカル履歴のみ表示できます。",
	"chat.history.searchPlaceholder": "セッションを検索…",
	"chat.history.searchAria": "セッションを検索",
	"chat.history.searchingTranscripts": "会話記録を検索中…",
	"chat.history.onlyThisFolder": "このフォルダのみ",
	"chat.history.onlyThisFolderTitle":
		"作業フォルダがこのフォルダのセッションだけを表示します。チェックを外すとすべてのフォルダのセッションが表示されます。",
	"chat.history.loadingSessions": "セッションを読み込み中…",
	"chat.history.noLocalWithCount":
		"ローカルセッションはまだありません。エージェントに {count} 件あります — 「エージェント」で確認してください。",
	"chat.history.noLocalMaybe":
		"ローカルセッションはまだありません。エージェントに保存済みのセッションがあるかもしれません — 「エージェント」で確認してください。",
	"chat.history.viewAgentSessions": "エージェントのセッションを表示",
	"chat.history.noMatch": "検索に一致するセッションがありません",
	"chat.history.noPrevious": "以前のセッションはありません",
	"chat.history.loadMore": "さらに読み込む",
	"chat.history.loading": "読み込み中…",
	// ---- Phase 3: quick prompts ----
	"chat.quickPrompts.queuedTooltip":
		"メッセージが待機中です — 別の内容を送るには編集または削除してください",
	"chat.quickPrompts.newTabTooltip":
		"クリック: 新しいタブで開く · {mod}クリック: バックグラウンドで開く · {alt}クリック: 入力欄に入れて先に編集",
	"chat.quickPrompts.thisTabTooltip":
		"クリック: このチャットで送信 · {mod}クリック: 新しいバックグラウンドタブで送信（{shift} を足すとそのタブへ移動）· {alt}クリック: 入力欄に入れて先に編集",
	"chat.quickPrompts.showMore":
		"あと {count} 件を表示 — すべてのクイックプロンプトを検索",
	"chat.quickPrompts.editPrompt": "プロンプトを編集",
	"chat.quickPrompts.copyPrompt": "プロンプトをコピー",
	"chat.quickPrompts.rename": "名前を変更",
	"chat.quickPrompts.addedToDraft":
		"下書きに追加しました — 確認して送信してください",
	"chat.quickPrompts.needsSelection":
		"「{label}」には選択範囲が必要です — 代わりに入力欄へ入れました。",
	"chat.quickPrompts.startedInNewTab":
		"「{label}」を新しいタブで開始しました。",
	"chat.quickPrompts.openedInNewTab":
		"「{label}」を編集できるよう新しいタブで開きました。",
	"chat.quickPrompts.createFromMessage":
		"このメッセージからクイックプロンプトを作成",
	"chat.quickPrompts.create": "クイックプロンプトを作成",
	"chat.quickPrompts.createFirst": "最初のクイックプロンプトを作成",
	"chat.quickPrompts.createNamed": "クイックプロンプト「{query}」を作成",
	"chat.quickPrompts.newPromptName": "新規プロンプト",
	// ---- Phase 3: A2UI interactive buttons ----
	"chat.a2ui.disabledStreaming": "この返信が終わると使えます",
	"chat.a2ui.disabledSending": "現在の返信が終わるまでお待ちください",
	"chat.a2ui.disabledQueued": "すでに送信待ちのメッセージがあります",
	"chat.a2ui.disabledRestoring": "先に会話を読み込んでいます",
	"chat.a2ui.disabledPending": "選択を送信中…",
	"chat.a2ui.disabledAnswered": "回答済み",
	"chat.a2ui.disabledSuperseded": "より新しい選択肢が下にあります",
	"chat.a2ui.inertReason":
		"ボタンを安全に表示できなかったため、内容をコードのまま残しています。",
	// ---- Phase 3: banners, blocks, and errors ----
	"chat.carriedOver.title": "{agent} から引き継いだ会話",
	"chat.carriedOver.show": "表示",
	"chat.carriedOver.hide": "非表示",
	"chat.carriedOver.you": "あなた",
	"chat.carriedOver.assistant": "アシスタント",
	"chat.errors.tabCrashTitle": "このタブでエラーが発生しました",
	"chat.errors.retry": "再試行",
	"chat.terminal.waitingForOutput": "出力を待っています...",
	"chat.terminal.noOutput": "出力なし",
	"chat.terminal.exitCode": "終了コード: {code}",
	"chat.terminal.signal": " | シグナル: {signal}",
	"chat.toolCall.title": "ツール呼び出し",
	"chat.toolCall.newFile": "新規ファイル",
	"chat.toolCall.lines": "{count} 行",
	"chat.toolCall.collapsed": "折りたたみ。",
	"chat.toolCall.expanded": "展開。",
	"chat.toolCall.contentRegion": "{title} の内容",
	"chat.toolCall.input": "入力",
	"chat.toolCall.output": "出力",
	"chat.mcpBanner.toolFailed":
		"サーバーにサインインしていないため、このツールは失敗しました。",
	"chat.mcpBanner.toolFailedOpens":
		"サーバーにサインインしていないため、このツールは失敗しました。{host} を開きます。",
	"chat.mcpBanner.looksLikeSignIn": "サインインの問題のようです",
	"chat.mcpBanner.mayNeedSignIn":
		"MCP サーバーの再サインインが必要かもしれません。セッションをやり直すと新しいサインイン要求が表示されます。",
	"chat.mcpBanner.reauthenticate": "再認証…",
	"chat.sharedLinks.none": "共有リンクはまだありません",
	"chat.sharedLinks.count": "共有リンク（{count}）",
	"chat.sharedLinks.countWithNew": "共有リンク（{count}、新着 {new} 件）",
	"chat.lossyFallback.title": "履歴から復元されたセッション",
	"chat.lossyFallback.body":
		"元のセッションはエージェント側で利用できなくなりました。以前の会話の記録をもとに作業しますが、元のセッションの内部状態や以前の推論にはアクセスできません。一部のツール出力も切り詰められている可能性があります。",
	"chat.historyBanner.notStored":
		"このタブの履歴はローカルに保存されていません。",
	"chat.historyBanner.reloading": "再読み込み中…",
	"chat.historyBanner.reloadFromAgent": "エージェントから再読み込み",
	"chat.notifications.permissionBody": "{agent} が権限を要求しています。",
	// ---- Phase 3: boot registration labels ----
	"notices.bootPartHoverPreview": "ノートのホバープレビュー",
	"notices.bootPartRibbon": "リボンボタン",
	"notices.bootPartCommands": "コマンド",
	"notices.bootPartSettingsTab": "設定タブ",
	// ---- Phase 3 addendum ----
	"chat.notifications.responseComplete": "{agent} · 応答完了",
	"chat.picker.navigate": "移動",
	"chat.picker.addToContext": "コンテキストに追加",
	"chat.picker.dismiss": "閉じる",
	"chat.picker.run": "実行",
	"chat.picker.create": "作成",
	"chat.picker.newTab": "新しいタブ",
	"chat.picker.switch": "切り替え",
	"chat.picker.insert": "挿入",
	"chat.picker.opensInNewTab": "新しいタブで開く",
	"chat.picker.usesSelection": "選択中のテキストを使用",
	"chat.folderPicker.selectDirectory": "ディレクトリを選択",
	"chat.acpErrors.titleProtocol": "プロトコルエラー",
	"chat.acpErrors.titleInvalidRequest": "無効なリクエスト",
	"chat.acpErrors.titleMethodNotSupported": "未対応のメソッド",
	"chat.acpErrors.titleInvalidParams": "無効なパラメーター",
	"chat.acpErrors.titleInternal": "内部エラー",
	"chat.acpErrors.titleAuthRequired": "認証が必要",
	"chat.acpErrors.titleResourceNotFound": "リソースが見つかりません",
	"chat.acpErrors.titleAgent": "エージェントエラー",
	"chat.acpErrors.unexpected": "予期しないエラーが発生しました。",
	"chat.acpErrors.suggestTooLong":
		"会話が長すぎます。利用できる場合は compact コマンドを使うか、新しいチャットを始めてください。",
	"chat.acpErrors.suggestBusy":
		"サービスが混み合っています。しばらく待ってからもう一度お試しください。",
	"chat.acpErrors.suggestRestart":
		"エージェントセッションをやり直してみてください。",
	"chat.acpErrors.suggestCheckConfig":
		"設定でエージェント構成を確認してください。",
	"chat.acpErrors.suggestTryAgainRestart":
		"もう一度試すか、エージェントセッションをやり直してください。",
	"chat.acpErrors.suggestCheckAuth":
		"ログインしているか、API キーが正しく設定されているか確認してください。",
	"chat.acpErrors.suggestCheckResource":
		"ファイルやリソースが存在するか確認してください。",
	"chat.acpErrors.stderrApiKeyMissing":
		"エージェントの API キーがないようです。カスタムエージェントの場合は、エージェントの環境変数設定に必要な API キー（例: ANTHROPIC_API_KEY）を追加してください。",
	"chat.acpErrors.stderrAuth":
		"エージェントが認証エラーを報告しました。API キーや資格情報が有効か確認してください。",
	"chat.acpErrors.cantStartTitle": "{agent} を起動できません",
	"chat.acpErrors.notInstalled":
		"{agent} はインストールされていないようです（\"{command}\" を実行できませんでした）。インストールするか、設定でパスを指定してください。",
	"chat.acpErrors.startupErrorTitle": "エージェント起動エラー",
	"chat.acpErrors.failedToStart": "{agent} の起動に失敗しました: {message}",
	"chat.acpErrors.checkAgentConfig":
		"設定でエージェント構成を確認してください。",
	"chat.acpErrors.pathHintWsl":
		"1. エージェントのパスを確認: WSL ターミナルで \"which {command}\" を実行して正しいパスを見つけてください。2. エージェントに Node.js が必要な場合は、一般設定の Node.js パスも確認してください（\"which node\" で見つかります）。",
	"chat.acpErrors.pathHintWin":
		"1. エージェントのパスを確認: コマンドプロンプトで \"where {command}\" を実行して正しいパスを見つけてください。2. エージェントに Node.js が必要な場合は、一般設定の Node.js パスも確認してください（\"where node\" で見つかります）。",
	"chat.acpErrors.pathHintUnix":
		"1. エージェントのパスを確認: ターミナルで \"which {command}\" を実行して正しいパスを見つけてください。2. エージェントに Node.js が必要な場合は、一般設定の Node.js パスも確認してください（\"which node\" で見つかります）。",
	"chat.acpErrors.cannotSendTitle": "メッセージを送信できません",
	"chat.acpErrors.noActiveSession":
		"アクティブなセッションがありません。接続をお待ちください。",
	"chat.acpErrors.sendFailedTitle": "メッセージ送信失敗",
	"chat.acpErrors.sendFailed": "メッセージを送信できませんでした",
	"chat.acpErrors.permissionErrorTitle": "権限エラー",
	"chat.acpErrors.permissionRespondFailed":
		"権限リクエストへの応答に失敗しました: {message}",
	"chat.acpErrors.errorOccurred": "エラーが発生しました",
	"chat.acpErrors.agentNotFoundTitle": "エージェントが見つかりません",
	"chat.acpErrors.agentNotFound":
		"ID \"{agentId}\" のエージェントが設定に見つかりません",
	"chat.acpErrors.checkYourAgentConfig":
		"設定でエージェント構成を確認してください。",
	"chat.acpErrors.sessionCreationFailedTitle": "セッション作成失敗",
	"chat.acpErrors.sessionCreationFailed":
		"新しいセッションを作成できませんでした: {message}",
	"chat.acpErrors.checkConfigTryAgain":
		"エージェント構成を確認して、もう一度お試しください。",
	"chat.history.failedFetch": "セッションの取得に失敗しました: {message}",
	"chat.history.failedLoadMore":
		"セッションの追加読み込みに失敗しました: {message}",
	"chat.history.failedRestore": "セッションの復元に失敗しました: {message}",
	"chat.history.failedFork": "セッションのフォークに失敗しました: {message}",
	"chat.history.failedDelete": "セッションの削除に失敗しました: {message}",
	"chat.history.failedUpdateTitle": "タイトルの更新に失敗しました: {message}",
	"chat.installer.noNpm":
		"npm が見つかりません。Node.js（npm を含む）をインストールしてから再試行するか、コマンドをコピーしてターミナルで実行してください。",
	"chat.installer.needsPermission":
		"このインストールには現在のアカウントにない権限が必要です。コマンドをコピーしてターミナルで実行してください（sudo が必要な場合があります）。",
	"chat.installer.noNetwork":
		"ネットワークに接続できずインストールできませんでした。接続を確認して再試行するか、コマンドをコピーしてターミナルで実行してください。",
	"chat.installer.didntFinish":
		"インストールが完了しませんでした。コマンドをコピーしてターミナルで実行すると、完全なエラーを確認できます。",
	"chat.updateBanner.migrationTitle": "パッケージの移行が必要",
	"chat.updateBanner.renamed":
		"\"{old}\" は \"{new}\" に名前が変わりました。\nターミナルで次を実行してください:",
	"chat.updateBanner.updateTitle": "エージェントの更新があります",
	"chat.updateBanner.updateAvailable":
		"{package}: {current} → {latest}。\nターミナルで次を実行してください:",
	"modals.mcpAuth.linkExpiry":
		"サインインリンクはしばらくすると期限切れになります – ページにエラーが表示されたら、セッションをやり直して新しいリンクを取得してください。",
});
