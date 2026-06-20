# Quick Start

This guide will get you chatting with an AI agent in just a few minutes.

## Step 1: Choose Your Agent

Agent Console supports multiple AI agents. Choose one to start:

| Agent | Provider | Integration |
|-------|----------|-------------|
| **[Claude Code](/agent-setup/claude-code)** | Anthropic | via [ACP adapter](https://github.com/agentclientprotocol/claude-agent-acp) |
| **[Codex](/agent-setup/codex)** | OpenAI | via [Zed's adapter](https://github.com/zed-industries/codex-acp) |
| **[Gemini CLI](/agent-setup/gemini-cli)** | Google | with `--experimental-acp` option |
| **[Kiro CLI](/agent-setup/kiro-cli)** | Amazon | Built-in ACP — install from [kiro.dev](https://kiro.dev) |
| **[Custom](/agent-setup/custom-agents)** | Various | [Any ACP-compatible agent](https://agentclientprotocol.com/overview/agents) (e.g., OpenCode, Qwen Code) |

## Step 2: Install and Configure the Agent

Follow the setup guide for your chosen agent:

- [Claude Code Setup](/agent-setup/claude-code)
- [Codex Setup](/agent-setup/codex)
- [Gemini CLI Setup](/agent-setup/gemini-cli)
- [Custom Agents](/agent-setup/custom-agents)

Each guide covers installation, path configuration, and authentication.

## Step 3: Start Chatting

1. Click the **robot icon** in the left ribbon, or
2. Open the command palette (`Cmd/Ctrl + P`) and search for **"Open chat"**

The chat panel opens in the right sidebar. Type a message and press Enter!

::: tip
On a brand-new install, Agent Console opens this panel for you once and defaults to an agent it finds installed — see [First Run](/getting-started/first-run).
:::

## What's Next?

- Learn about [Note Mentions](/usage/mentions) to reference your notes in conversations
- Explore [Slash Commands](/usage/slash-commands) for quick actions
- Set up additional agents in [Agent Setup](/agent-setup/)
