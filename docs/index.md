---
layout: home

hero:
  name: "Agent Console"
  text: "Your Obsidian console for parallel agent work"
  tagline: Run multiple AI agents in parallel chat sessions inside your vault. Stop waiting on one agent before starting the next.
  image:
    src: /images/multi-session-animated.gif
    alt: Three agent sessions in parallel tabs beside an open note in Obsidian — each tab keeps its own conversation and status icon
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: View on GitHub
      link: https://github.com/donivatamazondotcom/obsidian-agent-console

features:
  - icon: ⚡
    title: Tabbed Multi-Session
    details: Run several agents side by side in a tabbed sidebar. Tabs, conversations, and scroll position survive an Obsidian restart — and a tab connects to its agent only when you start typing, so reopening your vault never fires up every agent at once.
  - icon: 🤖
    title: Multi-Agent Support
    details: Claude Code, Codex, Gemini CLI, Kiro CLI, or any custom ACP-compatible agent. Use the one you have set up.
  - icon: 📌
    title: Context You Control
    details: A context strip shows exactly what the agent sees. Pin the notes you want and they stay put as you move around your vault, instead of silently changing under you. @mentions, dragged-in images, and slash commands still work.
  - icon: 🪶
    title: Context Budget Goes Further
    details: Context notes are referenced, not re-pasted into every message — so a long multi-turn chat uses 65–80% fewer context tokens than re-sending a note's full content each turn. More window left for the actual work.
  - icon: 🎛️
    title: A Model for Every Task
    details: Run a fast model in one tab and a heavyweight one in another. Switch model or mode mid-conversation — each tab keeps its own choice, so the right tool is always one tab away.
  - icon: 💻
    title: See and Approve What Runs
    details: When an agent runs a command, you see it and its output right in the chat — and anything that touches your system waits for your approval first. No black-box actions.
  - icon: 🔍
    title: Session History
    details: Browse past chats and reopen any session in a tab — pick up a previous conversation right where it left off.
  - icon: 🎨
    title: Native & Theme-Friendly
    details: Agent Console adopts Obsidian’s native styling and theme variables instead of hardcoded colors and chrome, so it looks like part of your Obsidian and adapts to any custom theme.
  - icon: 🛡️
    title: Built to Be Reliable
    details: 330+ automated tests, lint and build checks on every change, a token-efficiency benchmark you can run yourself, and performance tracked against a baseline — so updates stay solid as the plugin grows.
---

## What is Agent Console?

Agent Console is an Obsidian plugin built on the [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol). It connects your vault to AI coding agents — Claude Code, Codex, Gemini CLI, Kiro CLI, and custom ACP-compatible agents — and lets you run several at once in a tabbed sidebar, so you can keep working while agents work.

Agent Console is based on [Agent Client](https://github.com/RAIT-09/obsidian-agent-client) by [@RAIT-09](https://github.com/RAIT-09), originally released under Apache-2.0. See [NOTICE](https://github.com/donivatamazondotcom/obsidian-agent-console/blob/main/NOTICE) for full attribution.

### Supported Agents

| Agent | Provider | Integration |
|-------|----------|-------------|
| **[Claude Code](https://github.com/anthropics/claude-code)** | Anthropic | via [ACP adapter](https://github.com/agentclientprotocol/claude-agent-acp) |
| **[Codex](https://github.com/openai/codex)** | OpenAI | via [Zed's adapter](https://github.com/zed-industries/codex-acp) |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Google | with `--experimental-acp` option |
| **[Kiro CLI](https://kiro.dev)** | Amazon | via built-in ACP support |
| **Custom** | Various | [Any ACP-compatible agent](https://agentclientprotocol.com/overview/agents) (e.g., OpenCode, Qwen Code) |

### Why parallel?

AI agents work asynchronously. Tell one to research, another to fix a bug, a third to draft documentation. Switch tabs while they work. Status icons show what each agent is doing — ready, busy, waiting on you, or stuck. Stop the context-switch tax of waiting for one agent before starting the next.

The mental model: tell agents *what work to do*, not *how to do it*. With the right [skills](https://agentskills.io/home), agents figure out the steps. You stay focused on the work itself, with several streams progressing at once.

Ready to get started? Check out the [Installation Guide](/getting-started/).
