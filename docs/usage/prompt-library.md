# Prompt Library

The prompt library turns a folder of markdown files into one-click buttons in the chat panel. Each file is a reusable prompt — "Summarize my notes", "Prepare a Slack update for this meeting", "Start my daily briefing" — and tags decide which notes each button shows up for.

Your notes stay clean: the prompts live in their own folder, not embedded in your content.

## Setup

1. Create a folder anywhere in your vault for your prompts (e.g. `Prompts`).
2. Go to **Settings → Agent Console → Prompt library** and set **Prompt library folder** to that folder.
3. Add prompt files (see below). Buttons appear in the chat panel automatically — above the message input — whenever the active note's tags match.

Leave the folder empty to disable the feature.

## Writing a prompt

A prompt is a markdown file: YAML frontmatter for the launch metadata, and the body is the prompt text sent to the agent. The format is inspired by [prompty.ai](https://prompty.ai) but is Agent Console's own minimal schema (no templating, no role parsing).

```markdown
---
name: daily briefing
description: "🗓️ Start daily brief."
agent: kiro-cli
model: claude-sonnet-4.6
mode: my-personal-va
tags: [dailyNote]
---

Create my daily briefing and sync today's meetings from my calendar.
```

### Frontmatter fields

| Field         | Required | Description                                                                                          |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `agent`       | **yes**  | Agent Console agent id — the **tool** to run (`kiro-cli`, `claude-code-acp`, …). Must be configured. |
| `description` | no       | Button label. Falls back to `name`, then the filename.                                               |
| `name`        | no       | Short name; used as the label fallback. Defaults to the filename.                                    |
| `model`       | no       | Model id to select before sending. Defaults to the agent's current model.                            |
| `mode`        | no       | Session mode to select — use this for a **tool-internal agent/persona** (see below).                 |
| `tags`        | no       | Tags that gate where the button shows. See [Tag matching](#tag-matching).                            |

The **body** (everything after the frontmatter) is the prompt. It's required.

### Agents vs. modes

Two layers, two fields:

- **`agent`** picks the **tool** Agent Console launches (`kiro-cli`, `claude-code-acp`, …) — the connection profiles from your settings.
- **`mode`** picks an **agent/persona inside that tool**. Many CLIs let you define your own agents (e.g. a Kiro agent named `my-personal-va`); these appear in the chat toolbar's leftmost dropdown, and Agent Console drives them over ACP as session *modes*. If the agent offers no matching mode, the prompt just runs with the default.

## Tag matching

Tags decide which buttons appear, based on the **active note's** tags (frontmatter `tags:` and inline `#tags`, read via Obsidian's tag index):

- A prompt with **no `tags`** is **global** — it always shows.
- A prompt with tags shows when the active note carries **any** of them (OR match).
- Matching ignores case and a leading `#`.
- When no markdown note is active, only global (untagged) prompts show.

So `tags: [dailyNote]` makes a button appear only while you're on a note tagged `#dailyNote`. Buttons update live as you switch notes.

## What happens on click

Clicking a button, in the **current** chat tab:

1. Pins the active note into the [context strip](/usage/context-strip) (same as the manual "Pin notes with +").
2. Switches the agent if the prompt names a different one (only on a fresh, empty tab).
3. Selects the prompt's `model` / `mode` once the session is ready.
4. Sends the prompt — the pinned note rides along on the first turn.

There's no separate tab spawned and no in-note configuration — the buttons live in the chat window itself.

## Examples

A meeting-note prompt (`Prompts/slack-update.md`):

```markdown
---
description: "💬 Slack update"
agent: claude-code-acp
tags: [meeting]
---

Prepare a concise Slack update summarizing this meeting's decisions and action items.
```

A global prompt available everywhere (`Prompts/summarize.md`):

```markdown
---
description: "📝 Summarize"
agent: claude-code-acp
---

Summarize my notes.
```

## See also

- [Context Strip](/usage/context-strip) — how the pinned note appears in a chat
- [Tabbed Sessions](/usage/tabbed-sessions) — prompts launch in the current tab
- [Model Selection](/usage/model-selection) — choosing a model per chat
