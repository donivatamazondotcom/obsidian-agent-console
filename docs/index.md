---
layout: home

hero:
  name: "Agent Console"
  text: "Your Obsidian console for parallel agent work"
  tagline: Run multiple AI agents in parallel chat sessions inside your vault. Stop waiting on one agent before starting the next.
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
  - icon: 🎛️
    title: Per-Tab Mode and Model
    details: Switch modes and models per chat without restarting. Each tab remembers its choices.
  - icon: 💻
    title: Terminal Integration
    details: Agents execute shell commands and show output inline in chat. Permission-controlled.
  - icon: 💾
    title: Chat Export
    details: Save sessions as markdown into your vault for future reference and search.
  - icon: 🔍
    title: Session History
    details: Browse past chats and reopen any session in a tab. Fork from any point to explore alternatives.
---

## What is Agent Console?

Agent Console is an Obsidian plugin built on the [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol). It connects your vault to AI coding agents — Claude Code, Codex, Gemini CLI, Kiro CLI, and custom ACP-compatible agents — and lets you run several at once in a tabbed sidebar, so you can keep working while agents work.

It is a fork of [RAIT-09/obsidian-agent-client](https://github.com/RAIT-09/obsidian-agent-client) (Apache-2.0) that adds tabbed multi-session UX and ships as a separately-distributed plugin. See [NOTICE](https://github.com/donivatamazondotcom/obsidian-agent-console/blob/main/NOTICE) for full attribution.

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
