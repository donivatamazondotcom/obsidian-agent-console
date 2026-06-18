<div align="center">

<img src="docs/public/images/logo.svg" alt="Agent Console logo" width="88">

# Agent Console

**Collaborate with agents on your second brain.**

[![Version](https://img.shields.io/github/v/release/donivatamazondotcom/obsidian-agent-console?label=version&color=8b5cf6)](https://github.com/donivatamazondotcom/obsidian-agent-console/releases)
[![Obsidian downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%22agent-console%22%5D.downloads&label=downloads&color=8b5cf6)](https://community.obsidian.md/plugins/agent-console)
[![License](https://img.shields.io/badge/license-Apache--2.0-8b5cf6)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/donivatamazondotcom/obsidian-agent-console/ci.yaml?branch=main&label=build&color=8b5cf6)](https://github.com/donivatamazondotcom/obsidian-agent-console/actions/workflows/ci.yaml)
[![Docs](https://img.shields.io/badge/docs-online-8b5cf6)](https://donivatamazondotcom.github.io/obsidian-agent-console/)

<img src="docs/public/images/multi-session-animated.gif" alt="Three agent sessions in parallel tabs beside an open note in Obsidian – each tab keeps its own conversation and status icon" width="800">

**[📦 Install from Obsidian](https://community.obsidian.md/plugins/agent-console) &nbsp;·&nbsp; [📖 Documentation](https://donivatamazondotcom.github.io/obsidian-agent-console/) &nbsp;·&nbsp; [💬 Discussions](https://github.com/donivatamazondotcom/obsidian-agent-console/discussions)**

</div>

## Why Agent Console

Most AI agents start every chat from zero – they know nothing about you until you paste it in. Agent Console brings agents into your Obsidian vault instead, so they work from the notes you’ve already written. @mention a note and the agent reads it – and the notes it links to – for context. Ask it to write back – capture a decision, draft a note, link an idea – and your second brain grows as you work, without the tedious upkeep.

Because the agents live in your vault, you stay in control: you pin what they see, and you approve anything that runs. And since they work asynchronously, you can run several at once – one researching, one drafting, one vibe-coding a script – each in its own tab, each showing whether it’s ready, busy, or waiting on you. Stop waiting on one before starting the next.

> **The shift in how you work:** Tell the agent *what you want done*, not *how to do it*. With the right [skills](https://agentskills.io/home), the agent figures out the steps. You stay focused on the work itself. With many tabs, you can have several things happening at once, without losing track.

## See it in action

<table>
<tr>
<td width="50%" align="center">
<img src="docs/public/images/sending-messages.webp" alt="The composer with a vault note pinned in the context strip" width="380"><br>
<b>Bring your notes in as context</b><br>
<sub>Pin notes in the context strip, or @-mention any note.</sub>
</td>
<td width="50%" align="center">
<img src="docs/public/images/slash-commands-1.webp" alt="The slash-command menu open in the composer" width="380"><br>
<b>Slash commands, built in</b><br>
<sub>Type / to run your agent's commands.</sub>
</td>
</tr>
<tr>
<td width="50%" align="center">
<img src="docs/public/images/model-selection.webp" alt="The model picker open in a chat tab" width="380"><br>
<b>A model for every task</b><br>
<sub>Switch model or mode per tab, mid-chat.</sub>
</td>
<td width="50%" align="center">
<img src="docs/public/images/editing.webp" alt="A file-edit permission card showing a diff with Allow and Reject buttons" width="380"><br>
<b>See and approve what runs</b><br>
<sub>Edits and commands wait for your OK.</sub>
</td>
</tr>
</table>

## Features

* **Work from the notes you’ve already written** – @mention a note and the agent reads it, and the notes it links to, as context. Drag in images, run slash commands – it starts from your knowledge, not a blank slate
* **Let your second brain grow itself** – ask an agent to write back: capture decisions, draft notes, and link ideas straight into your vault, without the manual upkeep
* **Stop waiting on one agent before starting the next** – run several agent chats side by side in one sidebar
* **Use the agent you’ve already set up** – Kiro CLI, Claude Code, Codex, Gemini CLI, or any custom agent built on the [Agent Client Protocol](https://github.com/zed-industries/agent-client-protocol)
* **Your context budget goes further** – context notes are referenced, not re-pasted into every message, so a long chat uses 65–80% fewer context tokens than re-sending the full note each turn
* **Restart Obsidian without losing your place** – your open tabs and their conversations reopen exactly as you left them; each sidebar pane restores its own tabs independently
* **Scroll up to read while the agent is still typing** – the incoming stream won’t yank you back to the bottom, so you can reread earlier output mid-response; tabs also keep their scroll position when you switch away and back
* **Tabs don’t spin up until you type** – opening a tab won’t start an agent session, or any of its MCP servers, until you actually type, so rereading past chats stays light

<details>
<summary><strong>More features</strong></summary>

* **See what every agent is doing without clicking around** – status icons show ready, busy, waiting on you, or stuck
* **Find old chats and continue them** – browse session history and reopen any past conversation in a tab
* **Rename tabs so you can find them** – give each tab a name that says what it’s for, so a wall of tabs stays searchable and memorable; drag to reorder, right-click to close
* **Pick the right model for each task** – switch modes and models per chat without restarting
* **Read the conversation, not the logs** – tool calls render as a single tappable summary row by default. Click to expand, click to collapse, errors auto-expand so you don’t miss them.
* **Your MCP tools come along** – whatever MCP servers your agent uses keep working in Agent Console with no extra setup
* **Switching from another agent plugin? Bring your setup** – import agent definitions, defaults, and API keys from another plugin (like Agent Client) in one click
* **Switch tabs with a hotkey** – bind keys under Settings → Hotkeys
* **Looks like part of your Obsidian** – it adopts Obsidian’s own styling and your theme’s variables instead of hardcoded colors and chrome, so any custom theme restyles it like a built-in panel

</details>

## What you can do with it

* **Do several things at once** – ask one agent to research a topic, another to prep your next meeting, a third to clean up your email. Each one works at its own pace.
* **Vibe-code a script or tool** – describe what you want, get working code back, and review the diff
* **Pull in your notes** – type `@` and the name of any note – meeting notes, contact info, project pages – and the agent uses it as context for the task
* **Make your vault fill itself** – with the right skills, agents write meeting notes, research summaries, and action items straight into your vault. No manual capture.
* **Compare two agents** – give the same task to two different agents in side-by-side tabs and see which answer you like better
* **Stay focused** – status icons tell you when an agent is ready or still working, so you don’t break your flow checking on it

The pattern: tell the agent what you want done. Switch tabs. Come back when status says ready.

## Install

### Through Obsidian Community Plugins (recommended)

Agent Console is in the [Obsidian Community Plugins store](https://community.obsidian.md/plugins/agent-console):

1. Open **Settings → Community plugins** in Obsidian
2. Click **Browse** and search for "Agent Console"
3. Click **Install**, then **Enable**

Obsidian updates the plugin automatically when a new version is released.

## Quick start

You’ll need an AI agent installed on your computer. Popular choices:

* [Kiro CLI](https://kiro.dev) – Amazon's agent
* [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) – Anthropic’s coding agent
* [Codex](https://github.com/zed-industries/codex-acp) – Zed’s reference agent
* [Gemini CLI](https://github.com/google-gemini/gemini-cli) – Google’s command-line agent
* Custom agents like OpenCode, Qwen Code, and others

Once you’ve set up the agent:

1. Open **Settings → Agent Console**
2. Enter the path to the agent and any API keys it needs
3. Click the robot icon in the ribbon to open the chat panel
4. Click the **+** button to open more tabs as you need them

## Configuration

Customize how each agent behaves under **Settings → Agent Console** – agent paths, modes, models, permissions, and tab behavior. Per-agent setup guides are in the [documentation](https://donivatamazondotcom.github.io/obsidian-agent-console/).

## Hotkeys

Move between tabs with a keystroke instead of the mouse. Set your preferred bindings under **Settings → Hotkeys**.

## How it works with your agent

Three things come together, and you control all of them:

* **Your notes give the agent context** – it reads notes, mentions, and attachments from your vault, so it works with your knowledge instead of starting from scratch
* **Your agent stays itself** – task instructions, custom rules, tools – Agent Console doesn’t get in the way of anything your agent already supports
* **Agent Console keeps everything running** – many tabs, status icons, parallel chats. The piece that lets you do more without losing track.

Whatever your agent can do, Agent Console lets you do many of those at once.

## Enterprise-grade quality

A plugin that runs live agent sessions in your vault has to be dependable. A few things keep it that way:

* **Bugs come back with a test** – when something breaks, the fix ships with an automated test that reproduces the bug first, so it stays fixed. There are 330+ tests across the plugin’s core logic.
* **Every change is checked before it lands** – each pull request runs linting, type-checking, and a full build before it can merge.
* **The efficiency claim is measured, not asserted** – the “65–80% fewer context tokens” figure comes from a benchmark you can run yourself (`npm run bench:tokens`), with a test that keeps it honest against the shipped code.
* **Performance is tracked against a baseline** – rendering and context-handling are benchmarked against a saved baseline on every change, so a slowdown gets flagged before it ships.

## Contributing

Issues and pull requests are welcome on the [GitHub repo](https://github.com/donivatamazondotcom/obsidian-agent-console).

For a big new feature, please file an issue first so we can talk about scope. Bug fixes can go straight to a pull request.

## License and Attribution

Apache License 2.0 – see [LICENSE](LICENSE).

Agent Console is based on [Agent Client](https://github.com/RAIT-09/obsidian-agent-client) by [@RAIT-09](https://github.com/RAIT-09), originally released under Apache-2.0. Changes are © Vinod Panicker. See [NOTICE](NOTICE) for full credits.

The Agent Client Protocol is developed by [Zed Industries](https://github.com/zed-industries/agent-client-protocol).
