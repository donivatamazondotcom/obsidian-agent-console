# Agent Setup Overview

Agent Console supports multiple AI agents through the [Agent Console Protocol (ACP)](https://github.com/agentclientprotocol/agent-console-protocol). This section covers how to set up each supported agent.

## Supported Agents

| Agent | Provider | Package |
|-------|----------|---------|
| [Claude Code](./claude-code) | Anthropic | `@agentclientprotocol/claude-agent-acp` |
| [Codex](./codex) | OpenAI | `@zed-industries/codex-acp` |
| [Gemini CLI](./gemini-cli) | Google | `@google/gemini-cli` |
| [Custom Agents](./custom-agents) | Various | Any ACP-compatible agent |

## Common Setup Steps

All agents follow a similar setup pattern:

1. **Install the agent package** via npm
2. **Set up authentication** (API key or account login)

The plugin resolves bare command names through your login shell's PATH, so path configuration is often not needed. If the agent is not found automatically, use `which` (macOS/Linux) or `where.exe` (Windows) to find the path and configure it in Settings → Agent Console.

## WSL Mode (Windows)

For Windows users, we recommend using **WSL Mode** for better compatibility:

1. Install [WSL](https://docs.microsoft.com/en-us/windows/wsl/install)
2. Install Node.js and agents inside WSL
3. Enable **WSL Mode** in Settings → Agent Console
4. Use Linux-style paths (e.g., `/usr/local/bin/node`)

## Switching Agents

Once you have multiple agents configured, you can switch between them using the **⋮** menu in the chat header. To change the default agent for new chat views, go to **Settings → Agent Console → Default agent**.
