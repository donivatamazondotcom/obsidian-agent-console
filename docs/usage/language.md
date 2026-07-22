# Language

Use Agent Console in your own language. The plugin's buttons, menus, settings, and messages follow the language you picked for Obsidian — no setup needed.

## Supported languages

| Language | Status |
|---|---|
| English | Source language |
| 한국어 (Korean) | Settings, notifications, dialogs, chat panel, and commands translated — reviewed by native speaker Michaela Kim (newest strings machine-translated) |
| 中文 (Chinese, Simplified) | Settings, notifications, dialogs, chat panel, and commands translated (machine-translated) |
| 日本語 (Japanese) | Settings, notifications, dialogs, chat panel, and commands translated (machine-translated) |

More languages (German, Spanish, French, Brazilian Portuguese) are planned. The plugin's user-facing surfaces — settings, notifications, dialogs, the chat panel, and command names — are translated. Anything not yet translated shows in English. If Obsidian runs in Traditional Chinese, the plugin shows the Simplified Chinese catalog.

## How it works

By default the plugin matches Obsidian's language (**Settings → General → Language**). If Obsidian runs in a language the plugin doesn't support yet, everything stays in English.

## Replies and tab titles in your language

When the plugin is set to a language other than English, it also asks the agent to **reply in your language** and to **name new tabs in your language** (for the "suggested by the agent" tab-title style). It stays flexible — if you write to the agent in another language or ask it to switch, it follows along.

This is a single switch, **Reply in my language**, under **Settings → Agent Console → Obsidian system prompt**. It's on by default and does nothing while the plugin is in English. Turn it off if you'd rather the agent decide its own reply language.

## Picking a different language

You can run the plugin in a different language than Obsidian:

1. Open **Settings → Agent Console**
2. Scroll to the **Appearance & notifications** section
3. Set **Language** to the one you want

The change applies the next time Obsidian reloads.

## Found a wrong or awkward translation?

Translations start out machine-generated and get refined by native speakers. If something reads wrong, [open an issue](https://github.com/donivatamazondotcom/obsidian-agent-console/issues) or send a pull request against the catalog files in `src/i18n/` — corrections are very welcome.

## Credits

- Korean (한국어) — reviewed and corrected by Michaela Kim.
